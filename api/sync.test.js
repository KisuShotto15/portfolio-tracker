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
  it('un device viejo NO pisa recurring mas nuevo de la nube', () => {
    const cloud = { recurring: [{ id: 1 }, { id: 2 }], recurringUpdatedAt: 100 };
    const stale = { recurring: [{ id: 1 }], recurringUpdatedAt: 50 };
    const out = mergeDocs(cloud, stale);
    expect(out.recurring).toEqual([{ id: 1 }, { id: 2 }]);
    expect(out.recurringUpdatedAt).toBe(100);
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
