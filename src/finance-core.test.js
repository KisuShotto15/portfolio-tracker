import { describe, it, expect } from 'vitest';
import {
  monthCatTotalsCore, catNetSpendCore, monthIncomeCore, isExtFlow,
  investmentFlowCore, holdingsTotalUsdCore, catBudgetPctCore, trackerTxBalancesCore,
} from './finance-core.js';

const tx = (o) => Object.assign({ date: '2026-07-05', type: 'Debit', category: 'Groceries', amountUSD: 10, wallet: '' }, o);

describe('monthCatTotals / catNetSpend / monthIncome', () => {
  const txs = [
    tx({ amountUSD: 50 }),
    tx({ amountUSD: 20, type: 'Credit' }),                       // refund reduce gasto
    tx({ amountUSD: 30, category: 'Home' }),
    tx({ amountUSD: 500, type: 'Credit', category: 'Income' }),
    tx({ date: '2026-06-10', amountUSD: 99 }),                   // otro mes: fuera
  ];
  const map = monthCatTotalsCore(txs);
  it('net spend = debits - credits del mes', () => {
    expect(catNetSpendCore(map, '2026-07', ['Groceries'])).toBe(30);
    expect(catNetSpendCore(map, '2026-07', ['Groceries', 'Home'])).toBe(60);
    expect(catNetSpendCore(map, '2026-06', ['Groceries'])).toBe(99);
  });
  it('refunds nunca vuelven el gasto negativo', () => {
    const m = monthCatTotalsCore([tx({ amountUSD: 5 }), tx({ amountUSD: 50, type: 'Credit' })]);
    expect(catNetSpendCore(m, '2026-07', ['Groceries'])).toBe(0);
  });
  it('income = creditos de Income', () => {
    expect(monthIncomeCore(map, '2026-07')).toBe(500);
    expect(monthIncomeCore(map, '2026-06')).toBe(0);
  });
});

describe('isExtFlow', () => {
  it('Investments y Transfer son flujo externo; el resto no', () => {
    expect(isExtFlow('Investments')).toBe(true);
    expect(isExtFlow('Transfer')).toBe(true);
    expect(isExtFlow('Income')).toBe(false);
    expect(isExtFlow('')).toBe(false);
  });
});

describe('investmentFlowCore', () => {
  const prev = { id: 1000, date: '2026-07-01', total: 20000 };
  const cur = { id: 2000, date: '2026-07-08', total: 25000 };
  it('atribuye por id dentro de (prev, cur]', () => {
    const txs = [
      tx({ id: 1500, category: 'Investments', amountUSD: 100 }),            // dentro
      tx({ id: 500, category: 'Investments', amountUSD: 77 }),              // antes de prev: fuera
      tx({ id: 2500, category: 'Investments', amountUSD: 88 }),             // despues de cur: fuera
      tx({ id: 1600, category: 'Transfer', type: 'Credit', amountUSD: 5000 }), // deposito: cuenta como inflow
      tx({ id: 1700, category: 'Groceries', amountUSD: 9 }),                // no es flujo externo
    ];
    expect(investmentFlowCore(txs, prev, cur)).toEqual({ invOut: 100, invIn: 5000 });
  });
  it('fallback por fecha cuando faltan ids', () => {
    const txs = [
      tx({ category: 'Investments', amountUSD: 40, date: '2026-07-03' }),
      tx({ category: 'Investments', amountUSD: 60, date: '2026-06-30' }), // <= prev.date: fuera
    ];
    const f = investmentFlowCore(txs, { date: '2026-07-01' }, { date: '2026-07-08' });
    expect(f.invOut).toBe(40);
  });
});

describe('holdingsTotalUsdCore', () => {
  it('suma on-chain + manuales con precio; sin precio vale 0', () => {
    const total = holdingsTotalUsdCore(
      [{ balanceUsd: 150.5 }, { balanceUsd: 49.5 }],
      [{ coin: 'BTC', qty: 0.01 }, { coin: 'XYZ', qty: 5 }],
      { BTC: 65000 },
    );
    expect(total).toBe(850);
  });
  it('vacio = 0', () => { expect(holdingsTotalUsdCore(null, null, null)).toBe(0); });
});

describe('catBudgetPctCore', () => {
  const g = { Groceries: 25, Home: 10 };
  const bm = { '2026-07': { Groceries: 40 } };
  it('override del mes gana al global; sin override hereda', () => {
    expect(catBudgetPctCore(g, bm, 'Groceries', '2026-07')).toBe(40);
    expect(catBudgetPctCore(g, bm, 'Home', '2026-07')).toBe(10);
    expect(catBudgetPctCore(g, bm, 'Groceries', '2026-08')).toBe(25);
    expect(catBudgetPctCore(g, bm, 'Health', '2026-07')).toBe(0);
  });
});

describe('trackerTxBalancesCore', () => {
  const wallets = [{ name: 'Provincial', trackerOnly: true }, { name: 'Cash', trackerOnly: false }];
  it('credit suma, debit resta; solo trackers; imported se ignora', () => {
    const map = trackerTxBalancesCore(wallets, [
      tx({ wallet: 'Provincial', type: 'Credit', amountUSD: 100 }),
      tx({ wallet: 'Provincial', amountUSD: 5.99 }),
      tx({ wallet: 'Provincial', amountUSD: 50, imported: true }), // fuera
      tx({ wallet: 'Cash', amountUSD: 10 }),                      // manual: fuera
    ]);
    expect(map).toEqual({ Provincial: 94.01 });
  });
  it('duplicado tracker+manual: las txs cuentan igual (tracker gana)', () => {
    const dup = [{ name: 'Provincial', trackerOnly: true }, { name: 'Provincial', trackerOnly: false }];
    const map = trackerTxBalancesCore(dup, [tx({ wallet: 'Provincial', amountUSD: 5.99 })]);
    expect(map.Provincial).toBeCloseTo(-5.99);
  });
});
