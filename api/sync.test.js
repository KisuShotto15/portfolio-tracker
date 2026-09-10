import { describe, it, expect } from 'vitest';
import { mergeDocs } from './sync.js';

// El bug critico: un device desactualizado pisaba campos LWW (recurring, budgets,
// etc.) porque el server no los tenia en su lista. Ahora el merge es generico por
// convencion "<campo>UpdatedAt"; estos tests bloquean la regresion.

describe('mergeDocs: createdAt de una tx es inmutable', () => {
  it('el merge del server conserva createdAt aunque gane la copia que no lo tiene', () => {
    const cloud = { transactions: [{ id: 1, updatedAt: 20, desc: 'nube' }] };
    const incoming = { transactions: [{ id: 1, updatedAt: 10, createdAt: 3 }] };
    const out = mergeDocs(cloud, incoming);
    expect(out.transactions[0].desc).toBe('nube');
    expect(out.transactions[0].createdAt).toBe(3);
  });
});

describe('mergeDocs LWW generico por convencion', () => {
  it('un device viejo NO pisa una lista LWW mas nueva de la nube', () => {
    const cloud = { notePins: ['a', 'b'], notePinsUpdatedAt: 100 };
    const stale = { notePins: ['a'], notePinsUpdatedAt: 50 };
    const out = mergeDocs(cloud, stale);
    expect(out.notePins).toEqual(['a', 'b']);
    expect(out.notePinsUpdatedAt).toBe(100);
  });

  it('un edit mas nuevo del device gana sobre la nube', () => {
    const cloud = { dashGoal: 5000, dashGoalUpdatedAt: 10 };
    const fresh = { dashGoal: 8000, dashGoalUpdatedAt: 20 };
    expect(mergeDocs(cloud, fresh).dashGoal).toBe(8000);
  });

  it('empate: gana la nube', () => {
    const cloud = { rate: 600, rateUpdatedAt: 30 };
    const inc = { rate: 999, rateUpdatedAt: 30 };
    expect(mergeDocs(cloud, inc).rate).toBe(600);
  });

  it('campo nuevo solo presente en incoming se adopta', () => {
    const out = mergeDocs({}, { budgetTotal: 700, budgetTotalUpdatedAt: 5 });
    expect(out.budgetTotal).toBe(700);
  });

  it('campos fetched de API (sin UpdatedAt) NO entran al LWW: incoming sobreescribe', () => {
    const cloud = { binanceBalance: 100, binanceUpdated: 'ayer' };
    const inc = { binanceBalance: 200, binanceUpdated: 'hoy' };
    const out = mergeDocs(cloud, inc);
    expect(out.binanceBalance).toBe(200);
  });

  it('categoryBudgets (objeto) respeta LWW como bloque', () => {
    const cloud = { categoryBudgets: { Home: 100 }, categoryBudgetsUpdatedAt: 200 };
    const stale = { categoryBudgets: { Home: 50, Food: 30 }, categoryBudgetsUpdatedAt: 100 };
    expect(mergeDocs(cloud, stale).categoryBudgets).toEqual({ Home: 100 });
  });

  it('transactions no se rompe por el loop generico (per-tx merge aparte)', () => {
    const cloud = { transactions: [{ id: 1, updatedAt: 10 }], transactionsUpdatedAt: 10 };
    const inc = { transactions: [{ id: 1, updatedAt: 20 }, { id: 2, updatedAt: 5 }], transactionsUpdatedAt: 20 };
    const out = mergeDocs(cloud, inc);
    expect(out.transactions.find(t => t.id === 1).updatedAt).toBe(20);
    expect(out.transactions.find(t => t.id === 2)).toBeTruthy();
  });
});

describe('mergeDocs tombstones revocables (undo de borrado)', () => {
  const NOW = Date.now();

  it('REGRESION: undo de un borrado sobrevive al merge autoritativo', () => {
    // La nube tiene el tombstone del delete (ts) y ya no tiene la tx;
    // el device hizo undo: manda la tx restaurada (updatedAt > ts) sin tombstone.
    // ts realistas (stamp() ~ now): el prune de 90d corre antes del merge.
    const cloud = { transactions: [], deletedTxIds: [{ id: NOW, ts: NOW - 2000 }] };
    const inc = { transactions: [{ id: NOW, updatedAt: NOW - 1000, desc: 'restaurada' }], deletedTxIds: [] };
    const out = mergeDocs(cloud, inc);
    expect(out.transactions).toHaveLength(1);
    expect(out.transactions[0].desc).toBe('restaurada');
    expect(out.deletedTxIds).toEqual([]); // tombstone revocado: no vuelve a matarla
  });

  it('un delete mas nuevo que la tx de la nube la elimina (y el tombstone queda)', () => {
    const cloud = { transactions: [{ id: NOW, updatedAt: NOW - 1000 }], deletedTxIds: [] };
    const inc = { transactions: [], deletedTxIds: [{ id: NOW, ts: NOW - 500 }] };
    const out = mergeDocs(cloud, inc);
    expect(out.transactions).toEqual([]);
    expect(out.deletedTxIds).toEqual([{ id: NOW, ts: NOW - 500 }]);
  });

  it('un tombstone viejisimo (fuera del TTL de 90d) se poda y no mata', () => {
    const cloud = { transactions: [{ id: NOW, updatedAt: NOW - 1000 }], deletedTxIds: [] };
    const inc = { transactions: [], deletedTxIds: [{ id: NOW, ts: 300 }] };
    const out = mergeDocs(cloud, inc);
    expect(out.transactions).toHaveLength(1);
    expect(out.deletedTxIds).toEqual([]);
  });

  it('tombstones legacy (numericos) siguen siendo irrevocables', () => {
    const cloud = { transactions: [], deletedTxIds: [NOW] };
    const inc = { transactions: [{ id: NOW, updatedAt: 9e15 }], deletedTxIds: [] };
    expect(mergeDocs(cloud, inc).transactions).toEqual([]);
  });
});

describe('mergeDocs: snapshots se mergean por item (F2)', () => {
  it('un push con marca vieja YA NO borra el snapshot que el otro device no tenia', () => {
    const cloud = { snapshots: [{ id: 1, date: '2026-07-31', total: 1000 }], snapshotsUpdatedAt: 200 };
    const stale = {
      snapshots: [{ id: 1, date: '2026-07-31', total: 1000 }, { id: 2, date: '2026-08-31', total: 1300 }],
      snapshotsUpdatedAt: 150,
    };
    const out = mergeDocs(cloud, stale);
    expect(out.snapshots.map((s) => s.date)).toEqual(['2026-07-31', '2026-08-31']);
    expect(out.snapshotsUpdatedAt).toBe(200);
  });

  it('el snapshot automatico de fin de mes creado en los dos devices no se duplica', () => {
    const fin = { id: 5, date: '2026-08-31', total: 1500, auto: true, updatedAt: 90 };
    const out = mergeDocs({ snapshots: [fin] }, { snapshots: [{ ...fin, id: 6, total: 1502, updatedAt: 95 }] });
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0].total).toBe(1502);
  });

  it('borrar un snapshot viaja al server y no revive', () => {
    // ts real: el tombstone se poda a los 90 dias, asi que uno con ts=150 se
    // descartaria por viejisimo antes de matar nada.
    const borrado = Date.now();
    const cloud = { snapshots: [{ id: 1, date: '2026-08-31', updatedAt: borrado - 1000 }] };
    const inc = { snapshots: [], deletedSnapDates: [{ id: '2026-08-31', ts: borrado }] };
    const out = mergeDocs(cloud, inc);
    expect(out.snapshots).toEqual([]);
    expect(out.deletedSnapDates).toEqual([{ id: '2026-08-31', ts: borrado }]);
  });

  it('volver a anotar ese dia revoca el tombstone', () => {
    const borrado = Date.now();
    const cloud = { snapshots: [], deletedSnapDates: [{ id: '2026-08-31', ts: borrado }] };
    const inc = { snapshots: [{ id: 7, date: '2026-08-31', total: 1400, updatedAt: borrado + 50 }] };
    const out = mergeDocs(cloud, inc);
    expect(out.snapshots).toHaveLength(1);
    expect(out.deletedSnapDates).toEqual([]);
  });

  it('un tombstone de snapshot fuera del TTL de 90d se poda y no mata', () => {
    const viejo = Date.now() - 100 * 24 * 60 * 60 * 1000;
    const cloud = { snapshots: [{ id: 1, date: '2026-01-31', updatedAt: 10 }] };
    const inc = { snapshots: [], deletedSnapDates: [{ id: '2026-01-31', ts: viejo }] };
    const out = mergeDocs(cloud, inc);
    expect(out.snapshots).toHaveLength(1);
    expect(out.deletedSnapDates).toEqual([]);
  });
});

describe('mergeDocs: wallets y reglas recurrentes por item', () => {
  it('la wallet que creo un device offline ya no la borra el push del otro', () => {
    const cloud = { manualWallets: [{ id: 1, name: 'Zinli', balance: 100, updatedAt: 200 }], manualWalletsUpdatedAt: 200 };
    const stale = {
      manualWallets: [{ id: 1, name: 'Zinli', balance: 100, updatedAt: 200 }, { id: 2, name: 'Ahorros', balance: 50, updatedAt: 150 }],
      manualWalletsUpdatedAt: 150,
    };
    const out = mergeDocs(cloud, stale);
    expect(out.manualWallets.map((w) => w.name)).toEqual(['Zinli', 'Ahorros']);
  });

  it('la MISMA wallet creada en dos devices se colapsa en una (si no, duplica el patrimonio)', () => {
    // Ids distintos (Date.now de cada uno) para la misma wallet: dos filas tracker
    // con el mismo nombre suman las mismas txs dos veces.
    const cloud = { manualWallets: [{ id: 111, name: 'Ahorros', trackerOnly: true, balance: 0, updatedAt: 10 }] };
    const inc = { manualWallets: [{ id: 222, name: 'ahorros', trackerOnly: true, balance: 0, updatedAt: 20 }] };
    const out = mergeDocs(cloud, inc);
    expect(out.manualWallets).toHaveLength(1);
    expect(out.manualWallets[0].id).toBe(222);
  });

  it('renombrar en un device no parte la wallet en dos', () => {
    const cloud = { manualWallets: [{ id: 1, name: 'Emily', updatedAt: 10 }] };
    const inc = { manualWallets: [{ id: 1, name: 'Emily M', updatedAt: 20 }] };
    const out = mergeDocs(cloud, inc);
    expect(out.manualWallets).toEqual([{ id: 1, name: 'Emily M', updatedAt: 20 }]);
  });

  it('borrar una wallet viaja y no revive', () => {
    const borrado = Date.now();
    const cloud = { manualWallets: [{ id: 1, name: 'Zinli', updatedAt: borrado - 1000 }] };
    const inc = { manualWallets: [], deletedWalletIds: [{ id: 1, ts: borrado }] };
    expect(mergeDocs(cloud, inc).manualWallets).toEqual([]);
  });

  it('editar el monto de una regla no borra la regla que creo el otro device', () => {
    const cloud = {
      recurring: [{ id: 1, label: 'Netflix', amount: 12, updatedAt: 100 }, { id: 2, label: 'Gym', amount: 30, updatedAt: 100 }],
      recurringUpdatedAt: 100,
    };
    const stale = { recurring: [{ id: 1, label: 'Netflix', amount: 15, updatedAt: 300 }], recurringUpdatedAt: 300 };
    const out = mergeDocs(cloud, stale);
    expect(out.recurring.map((r) => r.id)).toEqual([1, 2]);
    expect(out.recurring.find((r) => r.id === 1).amount).toBe(15);
  });

  it('lastRun mas nuevo gana: la regla no se re-ejecuta por una copia vieja', () => {
    const cloud = { recurring: [{ id: 1, lastRun: '2026-09', updatedAt: 300 }] };
    const inc = { recurring: [{ id: 1, lastRun: '2026-08', updatedAt: 100 }] };
    expect(mergeDocs(cloud, inc).recurring[0].lastRun).toBe('2026-09');
  });

  it('borrar una regla viaja y no revive', () => {
    const borrado = Date.now();
    const cloud = { recurring: [{ id: 1, label: 'Netflix', updatedAt: borrado - 1000 }] };
    const inc = { recurring: [], deletedRuleIds: [{ id: 1, ts: borrado }] };
    expect(mergeDocs(cloud, inc).recurring).toEqual([]);
  });

  it('las wallets de exchange y on-chain tambien se mergean por item', () => {
    const cloud = {
      exchangeWallets: [{ id: 1, name: 'Binance', balance: 500, updatedAt: 200 }], exchangeWalletsUpdatedAt: 200,
      onchainWallets: [{ id: 1, label: 'Trezor', address: '0xAA', updatedAt: 200 }], onchainWalletsUpdatedAt: 200,
    };
    const stale = {
      exchangeWallets: [{ id: 1, name: 'Binance', balance: 500, updatedAt: 200 }, { id: 2, name: 'OKX', balance: 20, updatedAt: 5 }],
      exchangeWalletsUpdatedAt: 5,
      onchainWallets: [{ id: 1, label: 'Trezor', address: '0xAA', updatedAt: 200 }, { id: 2, label: 'Fria', address: '0xBB', updatedAt: 5 }],
      onchainWalletsUpdatedAt: 5,
    };
    const out = mergeDocs(cloud, stale);
    expect(out.exchangeWallets.map((w) => w.name)).toEqual(['Binance', 'OKX']);
    expect(out.onchainWallets.map((w) => w.label)).toEqual(['Trezor', 'Fria']);
  });

  it('la misma direccion on-chain cargada en dos devices queda una sola vez', () => {
    const cloud = { onchainWallets: [{ id: 1, label: 'Trezor', address: '0xAA', updatedAt: 10 }] };
    const inc = { onchainWallets: [{ id: 2, label: 'Fria', address: '0xaa', updatedAt: 20 }] };
    const out = mergeDocs(cloud, inc);
    expect(out.onchainWallets).toHaveLength(1);
    expect(out.onchainWallets[0].label).toBe('Fria');
  });

  it('una lista que el cliente no mando no se pierde', () => {
    const cloud = { manualWallets: [{ id: 1, name: 'Zinli', updatedAt: 10 }], manualWalletsUpdatedAt: 10 };
    const out = mergeDocs(cloud, { dashGoal: 5, dashGoalUpdatedAt: 1 });
    expect(out.manualWallets.map((w) => w.name)).toEqual(['Zinli']);
  });
});
