import { describe, it, expect } from 'vitest';
import { nextStamp, maxObservedStamp, localFieldWins, vesToUsd, mergeTxArrays, mergeTombstones, pruneRevokedTombstones, tombId, tombKills, dueMonths } from './sync-core.js';

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
