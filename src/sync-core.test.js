import { describe, it, expect } from 'vitest';
import { nextStamp, maxObservedStamp, localFieldWins, vesToUsd, mergeTxArrays, mergeTombstones, pruneRevokedTombstones, tombId, tombKills, dueMonths, backfillRecurringTxWallets, renameWalletRefsCore, txCreatedAt, backfillTxCreatedAt, mergeSnapArrays, pruneRevokedSnapTombs, backfillSnapUpdatedAt, snapKey, mergeByKey, pruneRevokedByKey, backfillUpdatedAt, itemId, dedupeByNaturalKey, walletNameKey, onchainAddrKey, restoreTombstonesCore, autoPullAllowedCore, STUCK_PUSH_MS } from './sync-core.js';

const TS = ['transactionsUpdatedAt','snapshotsUpdatedAt','presetsUpdatedAt','recurringUpdatedAt'];

describe('nextStamp (monotonic logical clock)', () => {
  it('uses wall clock when it is ahead', () => {
    expect(nextStamp(100, 5000)).toBe(5000);
  });
  it('moves forward even when the wall clock goes backwards (skew)', () => {
    expect(nextStamp(5000, 100)).toBe(5001);
  });
  it('never returns a value <= prev', () => {
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      // simulate a stuck/backwards clock
      const next = nextStamp(prev, 1000);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });
});

describe('maxObservedStamp', () => {
  it('returns 0 for empty/null state', () => {
    expect(maxObservedStamp(null, TS)).toBe(0);
    expect(maxObservedStamp({}, TS)).toBe(0);
  });
  it('finds the max across timestamp fields', () => {
    expect(maxObservedStamp({ snapshotsUpdatedAt: 30, presetsUpdatedAt: 99 }, TS)).toBe(99);
  });
  it('also scans per-transaction updatedAt', () => {
    const o = { transactionsUpdatedAt: 10, transactions: [{ updatedAt: 5 }, { updatedAt: 777 }] };
    expect(maxObservedStamp(o, TS)).toBe(777);
  });
});

describe('localFieldWins', () => {
  it('local wins only when strictly newer than cloud', () => {
    expect(localFieldWins(10, 20)).toBe(true);
    expect(localFieldWins(20, 10)).toBe(false);
    expect(localFieldWins(10, 10)).toBe(false); // tie → cloud wins
  });
  it('treats missing timestamps as 0', () => {
    expect(localFieldWins(undefined, 5)).toBe(true);
    expect(localFieldWins(5, undefined)).toBe(false);
    expect(localFieldWins(undefined, undefined)).toBe(false);
  });
});

describe('vesToUsd', () => {
  it('converts at the given rate, 4 decimals', () => {
    expect(vesToUsd(360, 36)).toBe(10);
    expect(vesToUsd(100, 36)).toBe(2.7778);
  });
  it('rate 0/negativo/NaN → 0 en vez de Infinity/NaN', () => {
    expect(vesToUsd(100, 0)).toBe(0);
    expect(vesToUsd(100, -36)).toBe(0);
    expect(vesToUsd(100, NaN)).toBe(0);
  });
});

describe('mergeTxArrays (per-tx last-writer-wins)', () => {
  // ids numericos = tombstones legacy (irrevocables), como antes del cambio
  const del = (...ids) => ids;

  it('keeps cloud-only and local-only transactions', () => {
    const local = [{ id: 1, updatedAt: 5 }];
    const cloud = [{ id: 2, updatedAt: 5 }];
    const m = mergeTxArrays(local, cloud, del());
    expect(m.map(t => t.id).sort()).toEqual([1, 2]);
  });

  it('conserva createdAt cuando el ganador del LWW no lo trae', () => {
    // Un dispositivo sin actualizar pisa la tx sin createdAt: si se perdiera, la
    // fila volveria a ordenarse por su ultima edicion.
    const local = [{ id: 1, updatedAt: 10, createdAt: 3 }];
    const cloud = [{ id: 1, updatedAt: 20, desc: 'viejo' }];
    const m = mergeTxArrays(local, cloud, del());
    expect(m[0].desc).toBe('viejo');
    expect(m[0].createdAt).toBe(3);
    expect(cloud[0].createdAt).toBeUndefined();   // no muta el objeto de entrada
  });

  it('local wins when its updatedAt is strictly higher', () => {
    const local = [{ id: 1, updatedAt: 20, desc: 'local' }];
    const cloud = [{ id: 1, updatedAt: 10, desc: 'cloud' }];
    expect(mergeTxArrays(local, cloud, del())[0].desc).toBe('local');
  });

  it('cloud wins on a tie or when cloud is newer', () => {
    expect(mergeTxArrays([{ id: 1, updatedAt: 10, desc: 'local' }], [{ id: 1, updatedAt: 10, desc: 'cloud' }], del())[0].desc).toBe('cloud');
    expect(mergeTxArrays([{ id: 1, updatedAt: 10, desc: 'local' }], [{ id: 1, updatedAt: 30, desc: 'cloud' }], del())[0].desc).toBe('cloud');
  });

  it('drops deleted ids from both sides (tombstone)', () => {
    const local = [{ id: 1, updatedAt: 5 }, { id: 2, updatedAt: 5 }];
    const cloud = [{ id: 1, updatedAt: 9 }, { id: 3, updatedAt: 5 }];
    const m = mergeTxArrays(local, cloud, del(1));
    expect(m.map(t => t.id).sort()).toEqual([2, 3]);
  });

  it('does not duplicate a tx present on both sides', () => {
    const m = mergeTxArrays([{ id: 1, updatedAt: 5 }], [{ id: 1, updatedAt: 9 }], del());
    expect(m).toHaveLength(1);
  });

  it('missing updatedAt counts as 0 (cloud wins)', () => {
    const m = mergeTxArrays([{ id: 1, desc: 'local' }], [{ id: 1, updatedAt: 1, desc: 'cloud' }], del());
    expect(m[0].desc).toBe('cloud');
  });
});

// EL bug: la lista se ordenaba por updatedAt, asi que editar una tx (o adjuntarle
// una foto) la mandaba al tope como si se acabara de anotar.
describe('txCreatedAt (orden por alta, no por ultima edicion)', () => {
  it('una tx manual se ordena por su id (= Date.now() del alta), no por updatedAt', () => {
    var manual = { id: 1000, updatedAt: 9999 };   // creada temprano, editada al rato
    expect(txCreatedAt(manual)).toBe(1000);
  });

  it('una recurrente usa updatedAt: su id es deterministico por fecha, no hora de alta', () => {
    var rec = { id: 500, updatedAt: 8000, recurringId: 7, auto: true };
    expect(txCreatedAt(rec)).toBe(8000);
  });

  it('createdAt explicito gana sobre todo', () => {
    expect(txCreatedAt({ id: 1, updatedAt: 2, createdAt: 42 })).toBe(42);
    expect(txCreatedAt({ id: 1, updatedAt: 2, createdAt: 0 })).toBe(0);   // 0 es un valor, no un hueco
  });

  it('el orden del dia NO cambia al editar una tx vieja', () => {
    var txs = [
      { id: 100, desc: 'bomba',    updatedAt: 100 },
      { id: 200, desc: 'empanada', updatedAt: 200 },
      { id: 300, desc: 'chinos',   updatedAt: 300 },
      { id: 400, desc: 'mi super', updatedAt: 400 },
    ];
    backfillTxCreatedAt(txs);
    // Se le adjunta una foto a "mi super" y se edita "bomba": updatedAt salta al tope.
    txs[3].updatedAt = 9000;
    txs[0].updatedAt = 9500;
    var desc = txs.slice().sort(function(a, b){ return txCreatedAt(b) - txCreatedAt(a); }).map(function(t){ return t.desc; });
    expect(desc).toEqual(['mi super', 'chinos', 'empanada', 'bomba']);
  });
});

describe('backfillTxCreatedAt', () => {
  it('congela el createdAt derivado y es idempotente', () => {
    var txs = [{ id: 10, updatedAt: 99 }, { id: 20, updatedAt: 50, recurringId: 3 }];
    expect(backfillTxCreatedAt(txs)).toBe(2);
    expect(txs[0].createdAt).toBe(10);
    expect(txs[1].createdAt).toBe(50);
    txs[0].updatedAt = 100000;                  // una edicion posterior
    expect(backfillTxCreatedAt(txs)).toBe(0);   // ya congelado: no lo recalcula
    expect(txs[0].createdAt).toBe(10);
  });

  it('no toca updatedAt (re-estamparlo reordenaria todo y pelearia con el merge)', () => {
    var txs = [{ id: 10, updatedAt: 99 }];
    backfillTxCreatedAt(txs);
    expect(txs[0].updatedAt).toBe(99);
  });

  it('dos dispositivos derivan el MISMO createdAt sin sincronizarlo', () => {
    var a = [{ id: 10, updatedAt: 99 }], b = [{ id: 10, updatedAt: 99 }];
    backfillTxCreatedAt(a); backfillTxCreatedAt(b);
    expect(a[0].createdAt).toBe(b[0].createdAt);
  });
});

describe('tombstones revocables (regresion: undo de un borrado)', () => {
  it('BUG ORIGINAL: la tx restaurada por undo le gana al tombstone de la nube', () => {
    // delete en T=100 (tombstone en la nube), undo en T=200 (tx local restaurada)
    const cloudTombs = [{ id: 1, ts: 100 }];
    const local = [{ id: 1, updatedAt: 200, desc: 'restaurada' }];
    const tombs = mergeTombstones([], cloudTombs);
    const merged = mergeTxArrays(local, [], tombs);
    expect(merged).toHaveLength(1);
    expect(merged[0].desc).toBe('restaurada');
    // y el tombstone revocado se elimina para no matarla en merges futuros
    expect(pruneRevokedTombstones(tombs, merged)).toEqual([]);
  });

  it('un borrado mas nuevo que la ultima edicion SI mata la tx', () => {
    const merged = mergeTxArrays([{ id: 1, updatedAt: 100 }], [], [{ id: 1, ts: 300 }]);
    expect(merged).toEqual([]);
  });

  it('empate ts === updatedAt: gana el borrado (sin zombies)', () => {
    expect(mergeTxArrays([{ id: 1, updatedAt: 100 }], [], [{ id: 1, ts: 100 }])).toEqual([]);
  });

  it('tombstone legacy (id numerico) mata siempre, aunque la tx sea nueva', () => {
    expect(mergeTxArrays([{ id: 1, updatedAt: 9e15 }], [], [1])).toEqual([]);
  });

  it('mergeTombstones dedup por id conservando el ts mayor; legacy gana', () => {
    expect(mergeTombstones([{ id: 1, ts: 100 }], [{ id: 1, ts: 300 }])).toEqual([{ id: 1, ts: 300 }]);
    expect(mergeTombstones([{ id: 1, ts: 100 }], [1])).toEqual([1]);
    expect(mergeTombstones([1], [{ id: 1, ts: 999 }])).toEqual([1]);
  });

  it('tombId/tombKills manejan ambos formatos', () => {
    expect(tombId(5)).toBe(5);
    expect(tombId({ id: 5, ts: 1 })).toBe(5);
    expect(tombKills(5, { updatedAt: 9e15 })).toBe(true);
    expect(tombKills({ id: 5, ts: 10 }, { updatedAt: 20 })).toBe(false);
  });
});

describe('dueMonths (recurring schedule)', () => {
  const ym = r => r.map(o => o.ym);

  it('new rule: due this month once the day has passed', () => {
    expect(ym(dueMonths({ dayOfMonth: 5 }, new Date(2026, 5, 23)))).toEqual(['2026-06']);
  });

  it('new rule: not due yet when the day has not arrived', () => {
    expect(dueMonths({ dayOfMonth: 28 }, new Date(2026, 5, 23))).toEqual([]);
  });

  it('catches up missed months since lastRun', () => {
    expect(ym(dueMonths({ dayOfMonth: 5, lastRun: '2026-04' }, new Date(2026, 5, 23)))).toEqual(['2026-05', '2026-06']);
  });

  it('does not re-run a month already processed', () => {
    expect(dueMonths({ dayOfMonth: 5, lastRun: '2026-06' }, new Date(2026, 5, 23))).toEqual([]);
  });

  it('clamps day 31 to the last day of a short month', () => {
    const r = dueMonths({ dayOfMonth: 31, lastRun: '2026-01' }, new Date(2026, 1, 28));
    expect(r).toHaveLength(1);
    expect(r[0].dom).toBe(28); // Feb 2026
  });

  it('does not backfill months before the rule existed (first run)', () => {
    // created mid-June, day 1 already passed → only the current month, never May
    expect(ym(dueMonths({ dayOfMonth: 1 }, new Date(2026, 5, 23)))).toEqual(['2026-06']);
  });
});

describe('backfillRecurringTxWallets', () => {
  const rules = [{ id: 1, wallet: 'Provincial' }, { id: 2, wallet: 'Provincial' }];

  it('repairs a recurring tx left without a wallet (el bug de Disney+)', () => {
    // La regla se arreglo despues de que la tx ya se genero: la tx quedaba con
    // wallet:'' para siempre y nunca se debitaba del tracker.
    const txs = [{ id: 10, recurringId: 1, wallet: '', amountUSD: 12 }];
    expect(backfillRecurringTxWallets(rules, txs)).toHaveLength(1);
    expect(txs[0].wallet).toBe('Provincial');
  });

  it('no toca una tx que ya tiene wallet (ni la de otra regla)', () => {
    const txs = [
      { id: 10, recurringId: 1, wallet: 'Provincial' },
      { id: 11, recurringId: 2, wallet: 'Cash' },   // el usuario la movio a mano
    ];
    expect(backfillRecurringTxWallets(rules, txs)).toEqual([]);
    expect(txs[1].wallet).toBe('Cash');
  });

  it('ignora txs no recurrentes aunque no tengan wallet', () => {
    const txs = [{ id: 12, wallet: '' }, { id: 13, recurringId: null, wallet: '' }];
    expect(backfillRecurringTxWallets(rules, txs)).toEqual([]);
    expect(txs[0].wallet).toBe('');
  });

  it('no inventa wallet si la regla tampoco tiene', () => {
    const txs = [{ id: 14, recurringId: 9, wallet: '' }];
    expect(backfillRecurringTxWallets([{ id: 9, wallet: '' }], txs)).toEqual([]);
    expect(txs[0].wallet).toBe('');
  });

  it('es idempotente: la segunda pasada no reporta nada', () => {
    const txs = [{ id: 10, recurringId: 1, wallet: '' }];
    backfillRecurringTxWallets(rules, txs);
    expect(backfillRecurringTxWallets(rules, txs)).toEqual([]);
  });

  it('aguanta entradas nulas y listas vacias', () => {
    expect(backfillRecurringTxWallets(null, null)).toEqual([]);
    expect(backfillRecurringTxWallets(rules, [null, undefined])).toEqual([]);
  });
});

// Renombrar una wallet le cambia el nombre a la wallet, pero las txs la referencian
// por ese nombre: sin reetiquetarlas, el saldo del tracker cae a su base y el
// patrimonio cambia solo. Estos tests fijan que el renombre arrastre las referencias.
describe('renameWalletRefsCore', () => {
  it('reetiqueta las txs de la wallet vieja', () => {
    const txs = [
      { id: 1, wallet: 'Emily', amountUSD: 500 },
      { id: 2, wallet: 'Emily', amountUSD: 120 },
      { id: 3, wallet: 'Binance', amountUSD: 40 },
    ];
    const res = renameWalletRefsCore(txs, [], 'Emily', 'Emily M');
    expect(res.txs.map((t) => t.id)).toEqual([1, 2]);
    expect(txs.map((t) => t.wallet)).toEqual(['Emily M', 'Emily M', 'Binance']);
  });

  it('reetiqueta tambien las reglas recurrentes', () => {
    const rules = [{ id: 1, wallet: 'Emily' }, { id: 2, wallet: 'Cash' }];
    const res = renameWalletRefsCore([], rules, 'Emily', 'Emily M');
    expect(res.rules).toEqual([{ id: 1, wallet: 'Emily M' }]);
    expect(rules.map((r) => r.wallet)).toEqual(['Emily M', 'Cash']);
  });

  it('no toca nada si el nombre no cambia', () => {
    const txs = [{ id: 1, wallet: 'Emily' }];
    expect(renameWalletRefsCore(txs, [], 'Emily', 'Emily')).toEqual({ txs: [], rules: [] });
    expect(txs[0].wallet).toBe('Emily');
  });

  it('compara exacto: distinta mayuscula es otra wallet', () => {
    const txs = [{ id: 1, wallet: 'emily' }];
    expect(renameWalletRefsCore(txs, [], 'Emily', 'Emily M').txs).toEqual([]);
    expect(txs[0].wallet).toBe('emily');
  });

  it('ignora nombres vacios en cualquiera de los dos lados', () => {
    const txs = [{ id: 1, wallet: '' }, { id: 2, wallet: 'Emily' }];
    expect(renameWalletRefsCore(txs, [], '', 'Emily M')).toEqual({ txs: [], rules: [] });
    expect(renameWalletRefsCore(txs, [], 'Emily', '')).toEqual({ txs: [], rules: [] });
    expect(txs[1].wallet).toBe('Emily');
  });

  it('aguanta listas nulas y entradas nulas', () => {
    expect(renameWalletRefsCore(null, null, 'A', 'B')).toEqual({ txs: [], rules: [] });
    expect(renameWalletRefsCore([null, undefined], [null], 'A', 'B')).toEqual({ txs: [], rules: [] });
  });

  it('el saldo del tracker sobrevive el renombre', () => {
    // Es el bug entero en una linea: sin reetiquetar, este saldo se va a cero.
    const txs = [
      { id: 1, wallet: 'Emily', type: 'Credit', amountUSD: 500 },
      { id: 2, wallet: 'Emily', type: 'Debit', amountUSD: 120 },
    ];
    const saldo = (nombre) => txs
      .filter((t) => t.wallet === nombre)
      .reduce((s, t) => s + (t.type === 'Credit' ? 1 : -1) * t.amountUSD, 0);
    expect(saldo('Emily')).toBe(380);
    renameWalletRefsCore(txs, [], 'Emily', 'Emily M');
    expect(saldo('Emily')).toBe(0);
    expect(saldo('Emily M')).toBe(380);
  });
});

describe('mergeSnapArrays (merge por-item de snapshots)', () => {
  it('EL BUG F2: dos snapshots creados offline en distintos dispositivos sobreviven los dos', () => {
    // Antes toda la lista viajaba con un solo timestamp: la del telefono (marca
    // vieja) se descartaba entera y el snapshot del 31-ago desaparecia sin aviso.
    const nube = [{ id: 1, date: '2026-07-31', total: 1000, updatedAt: 200 }];
    const tel = [
      { id: 1, date: '2026-07-31', total: 1000, updatedAt: 200 },
      { id: 2, date: '2026-08-31', total: 1300, updatedAt: 150 },
    ];
    const out = mergeSnapArrays(tel, nube, []);
    expect(out.map((s) => s.date)).toEqual(['2026-07-31', '2026-08-31']);
  });

  it('el mismo dia anotado en los dos dispositivos queda como UN solo snapshot', () => {
    // Ids distintos (Date.now de cada uno) para la misma cosa: la clave es la fecha.
    const a = [{ id: 111, date: '2026-09-30', total: 900, updatedAt: 10 }];
    const b = [{ id: 222, date: '2026-09-30', total: 950, updatedAt: 20 }];
    const out = mergeSnapArrays(a, b, []);
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(950);
  });

  it('editar el monto en un dispositivo le gana a la copia vieja del otro', () => {
    const local = [{ id: 1, date: '2026-08-31', total: 1500, updatedAt: 300 }];
    const nube = [{ id: 1, date: '2026-08-31', total: 1300, updatedAt: 100 }];
    expect(mergeSnapArrays(local, nube, [])[0].total).toBe(1500);
  });

  it('empate de updatedAt: gana la nube (mismo criterio que las txs)', () => {
    const local = [{ id: 1, date: '2026-08-31', total: 1500, updatedAt: 100 }];
    const nube = [{ id: 1, date: '2026-08-31', total: 1300, updatedAt: 100 }];
    expect(mergeSnapArrays(local, nube, [])[0].total).toBe(1300);
  });

  it('un borrado mata al snapshot que sigue vivo en la nube', () => {
    const nube = [{ id: 1, date: '2026-08-31', total: 1300, updatedAt: 100 }];
    const out = mergeSnapArrays([], nube, [{ id: '2026-08-31', ts: 150 }]);
    expect(out).toEqual([]);
  });

  it('pero no mata al que se volvio a anotar despues del borrado', () => {
    const local = [{ id: 9, date: '2026-08-31', total: 1400, updatedAt: 200 }];
    const out = mergeSnapArrays(local, [], [{ id: '2026-08-31', ts: 150 }]);
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(1400);
  });

  it('el tombstone revocado se descarta para que no mate en el proximo merge', () => {
    const vivos = [{ id: 9, date: '2026-08-31', updatedAt: 200 }];
    const tombs = [{ id: '2026-08-31', ts: 150 }, { id: '2026-07-31', ts: 150 }];
    expect(pruneRevokedSnapTombs(tombs, vivos)).toEqual([{ id: '2026-07-31', ts: 150 }]);
  });

  it('aguanta listas nulas y entradas sin fecha', () => {
    expect(mergeSnapArrays(null, null, null)).toEqual([]);
    expect(mergeSnapArrays([{ id: 1 }, null], [], [])).toEqual([]);
  });
});

describe('backfillSnapUpdatedAt', () => {
  it('congela updatedAt en el id, igual en todos los dispositivos', () => {
    const snaps = [{ id: 1700, date: '2026-07-31' }, { id: 1800, date: '2026-08-31', updatedAt: 5 }];
    expect(backfillSnapUpdatedAt(snaps)).toBe(1);
    expect(snaps[0].updatedAt).toBe(1700);
    expect(snaps[1].updatedAt).toBe(5);   // no pisa el que ya tenia
  });

  it('un snapshot viejo backfilleado NUNCA le gana a una edicion real', () => {
    // El backfill vale el id (Date.now del alta); cualquier stamp() posterior es mayor.
    const viejo = [{ id: 1000, date: '2026-08-31', total: 100 }];
    const editado = [{ id: 1000, date: '2026-08-31', total: 999, updatedAt: 5000 }];
    backfillSnapUpdatedAt(viejo);
    expect(mergeSnapArrays(viejo, editado, [])[0].total).toBe(999);
    expect(mergeSnapArrays(editado, viejo, [])[0].total).toBe(999);
  });

  it('snapKey es la fecha', () => {
    expect(snapKey({ id: 1, date: '2026-01-05' })).toBe('2026-01-05');
    expect(snapKey(null)).toBeFalsy();
  });
});

describe('mergeByKey (merge por-item de wallets y reglas)', () => {
  it('EL BUG: lo que agrego el device offline ya no lo borra la lista del otro', () => {
    const nube = [{ id: 1, name: 'Zinli', updatedAt: 200 }];
    const tel = [{ id: 1, name: 'Zinli', updatedAt: 200 }, { id: 2, name: 'Ahorros', updatedAt: 150 }];
    expect(mergeByKey(tel, nube, [], itemId).map((w) => w.name)).toEqual(['Zinli', 'Ahorros']);
  });

  it('la edicion mas nueva gana item por item', () => {
    const local = [{ id: 1, amount: 15, updatedAt: 300 }];
    const nube = [{ id: 1, amount: 12, updatedAt: 100 }, { id: 2, amount: 30, updatedAt: 100 }];
    const out = mergeByKey(local, nube, [], itemId);
    expect(out.find((r) => r.id === 1).amount).toBe(15);
    expect(out.find((r) => r.id === 2).amount).toBe(30);
  });

  it('empate: gana la nube', () => {
    const out = mergeByKey([{ id: 1, v: 'local', updatedAt: 10 }], [{ id: 1, v: 'nube', updatedAt: 10 }], [], itemId);
    expect(out[0].v).toBe('nube');
  });

  it('el tombstone mata al item que sigue vivo del otro lado', () => {
    const out = mergeByKey([], [{ id: 1, updatedAt: 100 }], [{ id: 1, ts: 150 }], itemId);
    expect(out).toEqual([]);
  });

  it('pero no al que se volvio a crear despues del borrado', () => {
    const out = mergeByKey([{ id: 1, updatedAt: 200 }], [], [{ id: 1, ts: 150 }], itemId);
    expect(out).toHaveLength(1);
  });

  it('el tombstone revocado se descarta', () => {
    const tombs = [{ id: 1, ts: 150 }, { id: 2, ts: 150 }];
    expect(pruneRevokedByKey(tombs, [{ id: 1, updatedAt: 200 }], itemId)).toEqual([{ id: 2, ts: 150 }]);
  });

  it('aguanta listas nulas y entradas sin clave', () => {
    expect(mergeByKey(null, null, null, itemId)).toEqual([]);
    expect(mergeByKey([null, {}], [], [], itemId)).toEqual([]);
  });

  it('backfillUpdatedAt congela el updatedAt en el id', () => {
    const items = [{ id: 1700 }, { id: 1800, updatedAt: 5 }];
    expect(backfillUpdatedAt(items)).toBe(1);
    expect(items[0].updatedAt).toBe(1700);
    expect(items[1].updatedAt).toBe(5);
  });
});

describe('dedupeByNaturalKey (misma wallet creada en dos dispositivos)', () => {
  it('dos ids distintos con el mismo nombre quedan en UNA fila', () => {
    // Si no, dos trackers con el mismo nombre suman las MISMAS txs: el patrimonio
    // se duplica sin que nada lo avise.
    const ws = [{ id: 111, name: 'Ahorros', updatedAt: 10 }, { id: 222, name: 'ahorros', updatedAt: 20 }];
    const out = dedupeByNaturalKey(ws, walletNameKey);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(222);
  });

  it('empate de updatedAt: gana el id mas chico, igual en cliente y servidor', () => {
    const a = [{ id: 111, name: 'A', updatedAt: 10 }, { id: 222, name: 'a', updatedAt: 10 }];
    const b = [{ id: 222, name: 'a', updatedAt: 10 }, { id: 111, name: 'A', updatedAt: 10 }];
    expect(dedupeByNaturalKey(a, walletNameKey)[0].id).toBe(111);
    expect(dedupeByNaturalKey(b, walletNameKey)[0].id).toBe(111);   // no depende del orden
  });

  it('nombres distintos no se tocan y se respeta el orden', () => {
    const ws = [{ id: 1, name: 'Zinli' }, { id: 2, name: 'Efectivo' }, { id: 3, name: 'Emily' }];
    expect(dedupeByNaturalKey(ws, walletNameKey).map((w) => w.name)).toEqual(['Zinli', 'Efectivo', 'Emily']);
  });

  it('una wallet sin nombre no colapsa contra otra sin nombre', () => {
    const ws = [{ id: 1 }, { id: 2, name: '' }];
    expect(dedupeByNaturalKey(ws, walletNameKey)).toHaveLength(2);
  });

  it('las on-chain se colapsan por direccion, no por etiqueta', () => {
    const ws = [{ id: 1, label: 'Trezor', address: '0xAA', updatedAt: 10 }, { id: 2, label: 'Fria', address: '0xaa', updatedAt: 20 }];
    const out = dedupeByNaturalKey(ws, onchainAddrKey);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Fria');
  });
});

describe('restoreTombstonesCore (restaurar un backup borra de verdad)', () => {
  const LISTS = [
    { field: 'transactions', tomb: 'deletedTxIds', keyOf: itemId },
    { field: 'snapshots', tomb: 'deletedSnapDates', keyOf: snapKey },
    { field: 'manualWallets', tomb: 'deletedWalletIds', keyOf: itemId },
  ];

  it('EL BUG F3: lo anotado despues del backup se lapida en vez de volver solo', () => {
    // Sin lapida, el merge conserva la tx 2 (existe en la nube y no en el archivo)
    // y el restore se deshace solo en el siguiente pull.
    const local = { transactions: [{ id: 1 }, { id: 2 }] };
    const file = { transactions: [{ id: 1 }] };
    expect(restoreTombstonesCore(local, file, LISTS, 500)).toEqual({ deletedTxIds: [{ id: 2, ts: 500 }] });
  });

  it('lapida tambien snapshots (por fecha) y wallets (por id)', () => {
    const local = {
      transactions: [], snapshots: [{ id: 9, date: '2026-08-31' }, { id: 8, date: '2026-07-31' }],
      manualWallets: [{ id: 1, name: 'Zinli' }, { id: 2, name: 'Ahorros' }],
    };
    const file = { transactions: [], snapshots: [{ id: 8, date: '2026-07-31' }], manualWallets: [{ id: 1, name: 'Zinli' }] };
    const out = restoreTombstonesCore(local, file, LISTS, 700);
    expect(out.deletedSnapDates).toEqual([{ id: '2026-08-31', ts: 700 }]);
    expect(out.deletedWalletIds).toEqual([{ id: 2, ts: 700 }]);
    expect(out.deletedTxIds).toBe(undefined);   // nada que borrar: no ensucia el doc
  });

  it('lo que el archivo SI trae no se lapida', () => {
    const local = { transactions: [{ id: 1 }, { id: 2 }] };
    const file = { transactions: [{ id: 2 }, { id: 1 }] };   // mismo set, otro orden
    expect(restoreTombstonesCore(local, file, LISTS, 1)).toEqual({});
  });

  it('una lista que el backup no trae NO se toca', () => {
    // Backup viejo, anterior a esa lista: no hay forma de saber si estaba vacia.
    const local = { transactions: [{ id: 1 }], manualWallets: [{ id: 7, name: 'Zinli' }] };
    const file = { transactions: [{ id: 1 }] };
    expect(restoreTombstonesCore(local, file, LISTS, 1)).toEqual({});
  });

  it('una lista vacia en el archivo SI lapida todo lo local', () => {
    const local = { transactions: [{ id: 1 }, { id: 2 }] };
    const file = { transactions: [] };
    expect(restoreTombstonesCore(local, file, LISTS, 3).deletedTxIds).toEqual([{ id: 1, ts: 3 }, { id: 2, ts: 3 }]);
  });

  it('no repite lapidas ni lapida items sin clave', () => {
    const local = { transactions: [{ id: 5 }, { id: 5 }, {}, null] };
    const file = { transactions: [] };
    expect(restoreTombstonesCore(local, file, LISTS, 2).deletedTxIds).toEqual([{ id: 5, ts: 2 }]);
  });

  it('la lapida le gana a la copia vieja de la nube, y no a una edicion posterior', () => {
    // Es lo que hace que el restore sea una vuelta atras real sin romper lo que
    // otro dispositivo anote DESPUES.
    const tomb = restoreTombstonesCore({ transactions: [{ id: 2, updatedAt: 10 }] }, { transactions: [] }, LISTS, 500).deletedTxIds;
    expect(mergeByKey([], [{ id: 2, updatedAt: 10 }], tomb, itemId)).toEqual([]);
    expect(mergeByKey([], [{ id: 2, updatedAt: 900 }], tomb, itemId)).toHaveLength(1);
  });
});

describe('autoPullAllowedCore (un push atascado no congela la bajada)', () => {
  const base = { inFlight: false, hidden: false, online: true, dirty: false, syncFailed: false, failingSince: null };
  const ahora = 1_000_000;

  it('sin nada pendiente, baja', () => {
    expect(autoPullAllowedCore(base, ahora)).toBe(true);
  });

  it('no baja mientras hay un pull en vuelo, la pestana esta oculta o no hay red', () => {
    expect(autoPullAllowedCore({ ...base, inFlight: true }, ahora)).toBe(false);
    expect(autoPullAllowedCore({ ...base, hidden: true }, ahora)).toBe(false);
    expect(autoPullAllowedCore({ ...base, online: false }, ahora)).toBe(false);
  });

  it('no baja durante el push normal (el debounce todavia no fallo)', () => {
    expect(autoPullAllowedCore({ ...base, dirty: true }, ahora)).toBe(false);
  });

  it('tampoco apenas falla el primer push', () => {
    expect(autoPullAllowedCore({ ...base, dirty: true, syncFailed: true, failingSince: ahora - 5000 }, ahora)).toBe(false);
  });

  it('EL BUG F7: pero si lleva minutos sin poder subir, baja igual', () => {
    // Sin esto el dispositivo se quedaba con la pantalla vieja para siempre: la
    // bajada se salta mientras haya cambios sin subir, y no habia salida.
    const st = { ...base, dirty: true, syncFailed: true, failingSince: ahora - STUCK_PUSH_MS };
    expect(autoPullAllowedCore(st, ahora)).toBe(true);
  });

  it('atascado pero sin red: sigue sin bajar', () => {
    const st = { ...base, dirty: true, syncFailed: true, online: false, failingSince: ahora - STUCK_PUSH_MS };
    expect(autoPullAllowedCore(st, ahora)).toBe(false);
  });

  it('el umbral se puede bajar (lo usa el e2e para no esperar dos minutos)', () => {
    const st = { ...base, dirty: true, syncFailed: true, failingSince: ahora - 50 };
    expect(autoPullAllowedCore(st, ahora, 10)).toBe(true);
    expect(autoPullAllowedCore(st, ahora, 5000)).toBe(false);
  });

  it('syncFailed sin cambios locales tambien sale del atasco', () => {
    // El push fallido deja syncFailed en true aunque el cambio ya no este pendiente.
    const st = { ...base, syncFailed: true, failingSince: ahora - STUCK_PUSH_MS };
    expect(autoPullAllowedCore(st, ahora)).toBe(true);
  });
});
