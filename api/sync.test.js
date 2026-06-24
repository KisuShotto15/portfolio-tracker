import { describe, it, expect } from 'vitest';
import { mergeDocs } from './sync.js';

// El bug critico: un device desactualizado pisaba campos LWW (recurring, budgets,
// etc.) porque el server no los tenia en su lista. Ahora el merge es generico por
// convencion "<campo>UpdatedAt"; estos tests bloquean la regresion.

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
