import { describe, it, expect } from 'vitest';
import {
  monthCatTotalsCore, catNetSpendCore, monthIncomeCore, isExtFlow,
  investmentFlowCore, periodNetSpendCore, periodLoggedIncomeCore, snapDerivedIncomeCore,
  holdingsTotalUsdCore, catBudgetPctCore, budgetTotalForCore, trackerTxBalancesCore, debtSplitCore,
  rolloverCarryCore, catLimitWithCarryCore,
  EXPENSE_CATS_DASH, BUDGET_CATS, NEUTRAL_CATS,
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

describe('periodNetSpendCore', () => {
  const prev = { id: 1000, date: '2026-07-01', total: 20000 };
  const cur = { id: 2000, date: '2026-07-08', total: 20050 };
  const CATS = ['Groceries', 'Home', 'Eating Out'];

  it('suma solo las categorias pedidas dentro de (prev, cur]', () => {
    const txs = [
      tx({ id: 1500, category: 'Groceries', amountUSD: 300 }),   // dentro
      tx({ id: 1600, category: 'Home', amountUSD: 200 }),        // dentro
      tx({ id: 500, category: 'Groceries', amountUSD: 999 }),    // antes de prev: fuera
      tx({ id: 2500, category: 'Groceries', amountUSD: 999 }),   // despues de cur: fuera
      tx({ id: 1700, category: 'Investments', amountUSD: 400 }), // flujo externo: no es gasto
      tx({ id: 1800, category: 'Income', type: 'Credit', amountUSD: 550 }), // income: no es gasto
    ];
    expect(periodNetSpendCore(txs, prev, cur, CATS)).toBe(500);
  });

  it('reconstruye el income bruto: neto + gasto = bruto', () => {
    // Gane 550, gasto 500 → el patrimonio solo subio 50. El income real es 550.
    const txs = [tx({ id: 1500, category: 'Groceries', amountUSD: 500 })];
    const netProfit = cur.total - prev.total;                    // 50 (lo que ve el KPI Net Profit)
    const spent = periodNetSpendCore(txs, prev, cur, CATS);
    expect(netProfit).toBe(50);
    expect(netProfit + spent).toBe(550);
  });

  it('refunds reducen el gasto y nunca lo vuelven negativo', () => {
    const txs = [
      tx({ id: 1500, category: 'Groceries', amountUSD: 100 }),
      tx({ id: 1600, category: 'Groceries', type: 'Credit', amountUSD: 30 }),
    ];
    expect(periodNetSpendCore(txs, prev, cur, CATS)).toBe(70);
    const soloRefund = [tx({ id: 1500, category: 'Groceries', type: 'Credit', amountUSD: 30 })];
    expect(periodNetSpendCore(soloRefund, prev, cur, CATS)).toBe(0);
  });

  it('fallback por fecha cuando faltan ids', () => {
    const txs = [
      tx({ category: 'Groceries', amountUSD: 40, date: '2026-07-03' }),
      tx({ category: 'Groceries', amountUSD: 60, date: '2026-06-30' }), // <= prev.date: fuera
      tx({ category: 'Groceries', amountUSD: 70, date: '2026-07-20' }), // > cur.date: fuera
    ];
    expect(periodNetSpendCore(txs, { date: '2026-07-01' }, { date: '2026-07-08' }, CATS)).toBe(40);
  });
});

describe('categorias neutras', () => {
  // Caso real: una wallet tracker donde se anota lo que alguien debe. Cuando paga
  // $100 se registra Debit/Savings sobre esa wallet: el saldo de la deuda baja, la
  // plata aparece en otra wallet, y el patrimonio total no se mueve. No es income
  // (ya era tuyo) ni gasto (no lo consumiste).
  const cobro = tx({ id: 1500, category: 'Savings', type: 'Debit', amountUSD: 100 });
  const prev = { id: 1000, date: '2026-07-01', total: 20000 };
  const cur = { id: 2000, date: '2026-07-08', total: 20000 };   // sin cambio de patrimonio

  it('ninguna categoria neutra esta en las listas de gasto', () => {
    NEUTRAL_CATS.forEach((c) => {
      expect(EXPENSE_CATS_DASH).not.toContain(c);
      expect(BUDGET_CATS).not.toContain(c);
    });
  });

  it('ninguna categoria neutra es flujo externo', () => {
    NEUTRAL_CATS.forEach((c) => expect(isExtFlow(c)).toBe(false));
  });

  it('un cobro neutro no cuenta como gasto ni como income', () => {
    expect(periodNetSpendCore([cobro], prev, cur, EXPENSE_CATS_DASH)).toBe(0);
    expect(periodLoggedIncomeCore([cobro], prev, cur, {})).toBe(0);
    expect(monthIncomeCore(monthCatTotalsCore([cobro]), '2026-07')).toBe(0);
    expect(catNetSpendCore(monthCatTotalsCore([cobro]), '2026-07', EXPENSE_CATS_DASH)).toBe(0);
  });

  it('no distorsiona el income derivado: Δ=0 y gasto=0 ⇒ income=0', () => {
    // Si Savings entrara en las listas de gasto, este cobro valdria $100 de gasto Y
    // inflaria el income derivado en $100, porque recordSnapshot los suma de vuelta.
    const netProfit = cur.total - prev.total;                                   // 0
    const spent = periodNetSpendCore([cobro], prev, cur, EXPENSE_CATS_DASH);    // 0
    const logged = periodLoggedIncomeCore([cobro], prev, cur, {});              // 0
    expect(netProfit + spent - logged).toBe(0);
  });
});

describe('snapDerivedIncomeCore', () => {
  it('suma el derivedIncome de los snapshots del mes', () => {
    const snaps = [
      { id: 1, date: '2026-07-05', total: 100, derivedIncome: 300 },
      { id: 2, date: '2026-07-20', total: 200, derivedIncome: 250 },
      { id: 3, date: '2026-06-30', total: 90, derivedIncome: 999 },   // otro mes: fuera
    ];
    expect(snapDerivedIncomeCore(snaps, '2026-07')).toBe(550);
    expect(snapDerivedIncomeCore(snaps, '2026-06')).toBe(999);
    expect(snapDerivedIncomeCore(snaps, '2026-05')).toBe(0);
  });

  it('ignora snapshots legacy (txId, sin derivedIncome) — su income ya suma por las txs', () => {
    const snaps = [
      { id: 1, date: '2026-07-05', total: 100, txId: 555 },
      { id: 2, date: '2026-07-20', total: 200, derivedIncome: 250 },
    ];
    expect(snapDerivedIncomeCore(snaps, '2026-07')).toBe(250);
  });

  it('tolera snapshots sin fecha o sin campos', () => {
    expect(snapDerivedIncomeCore([null, {}, { date: '2026-07-01' }], '2026-07')).toBe(0);
    expect(snapDerivedIncomeCore(null, '2026-07')).toBe(0);
  });
});

describe('periodLoggedIncomeCore', () => {
  const prev = { id: 1000, date: '2026-07-01', total: 20000 };
  const cur = { id: 2000, date: '2026-07-08', total: 20100 };
  const inc = (o) => tx(Object.assign({ type: 'Credit', category: 'Income', amountUSD: 100 }, o));

  it('suma el income registrado a mano dentro del periodo', () => {
    const txs = [
      inc({ id: 1500, amountUSD: 100 }),
      inc({ id: 1600, amountUSD: 50 }),
      inc({ id: 500, amountUSD: 999 }),                       // antes de prev: fuera
      inc({ id: 2500, amountUSD: 999 }),                      // despues de cur: fuera
      tx({ id: 1700, category: 'Groceries', amountUSD: 30 }), // gasto: no es income
    ];
    expect(periodLoggedIncomeCore(txs, prev, cur, {})).toBe(150);
  });

  it('excluye las txs generadas por snapshots (asientos, no plata que entro)', () => {
    const txs = [inc({ id: 1500, amountUSD: 100 }), inc({ id: 1600, amountUSD: 400 })];
    expect(periodLoggedIncomeCore(txs, prev, cur, { 1600: 1 })).toBe(100);
  });

  it('sin doble conteo: registrado + derivado = income real', () => {
    // Entraron 100 (registrados a mano), no hubo gastos → el patrimonio subio 100.
    const txs = [inc({ id: 1500, amountUSD: 100 })];
    const netProfit = cur.total - prev.total;                  // 100
    const logged = periodLoggedIncomeCore(txs, prev, cur, {});
    const derived = netProfit + 0 - logged;                    // Δ + gastos - registrado
    expect(derived).toBe(0);
    expect(logged + derived).toBe(100);                        // no 200
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

describe('budgetTotalForCore', () => {
  const bm = { '2026-08': 850, '2026-09': 500 };
  it('override del mes gana al default; sin override hereda', () => {
    expect(budgetTotalForCore(600, bm, '2026-08')).toBe(850);
    expect(budgetTotalForCore(600, bm, '2026-09')).toBe(500);
    expect(budgetTotalForCore(600, bm, '2026-07')).toBe(600);
    expect(budgetTotalForCore(600, {}, '2026-07')).toBe(600);
  });
  it('un 0 explicito es un override valido, no un hueco', () => {
    expect(budgetTotalForCore(600, { '2026-08': 0 }, '2026-08')).toBe(0);
  });
  it('sin default configurado devuelve 0 (la metrica queda no disponible)', () => {
    expect(budgetTotalForCore(null, {}, '2026-08')).toBe(0);
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

describe('debtSplitCore', () => {
  var W = [
    { name: 'Emily', trackerOnly: true },                 // tracker comun: no es deuda
    { name: 'Roi', trackerOnly: true, debt: 'in' },       // me deben
    { name: 'Ana', trackerOnly: true, debt: 'out' },      // debo
    { name: 'Cash' },                                     // manual normal: no participa
  ];
  var B = { Emily: 200, Roi: 1550, Ana: 300, Cash: 99 };

  it('separa lo que debes del resto', () => {
    expect(debtSplitCore(W, B)).toEqual({ receivable: 1750, owed: 300 });
  });

  it('un tracker sin marcar sigue contando como antes (nada que migrar)', () => {
    expect(debtSplitCore([{ name: 'Emily', trackerOnly: true }], { Emily: 40 }))
      .toEqual({ receivable: 40, owed: 0 });
  });

  it('ignora los wallets que no son tracker', () => {
    expect(debtSplitCore([{ name: 'Cash', debt: 'out' }], { Cash: 500 }))
      .toEqual({ receivable: 0, owed: 0 });
  });

  it('un wallet sin saldo en el mapa cuenta 0, no NaN', () => {
    expect(debtSplitCore([{ name: 'X', trackerOnly: true, debt: 'out' }], {}).owed).toBe(0);
  });

  // La regla unica: Debit baja el saldo en los tres tipos. Lo que cambia es el signo
  // con el que cada uno entra al patrimonio, no como se mueve.
  it('un Debit baja tanto lo que te deben como lo que debes', () => {
    var txs = [
      { wallet: 'Roi', type: 'Debit', amountUSD: 150 },
      { wallet: 'Ana', type: 'Debit', amountUSD: 150 },
    ];
    var mv = trackerTxBalancesCore(W, txs);
    expect(mv.Roi).toBe(-150);
    expect(mv.Ana).toBe(-150);
    var d = debtSplitCore(W, { Emily: 200, Roi: 1550 + mv.Roi, Ana: 300 + mv.Ana });
    expect(d).toEqual({ receivable: 1600, owed: 150 });
    // te pagaron 150 y con eso pagaste 150: el patrimonio no se movio
    expect(d.receivable - d.owed).toBe(1750 - 300);
  });
});

describe('rollover de categoria', () => {
  it('lo que sobro suma al mes siguiente', () => {
    expect(rolloverCarryCore(450, 400)).toBe(50);
    expect(catLimitWithCarryCore(450, 50, true)).toBe(500);
  });

  it('lo que te pasaste resta', () => {
    expect(rolloverCarryCore(75, 92.4)).toBe(-17.4);
    expect(catLimitWithCarryCore(75, -17.4, true)).toBe(57.6);
  });

  it('sin limite el mes pasado no arrastra nada', () => {
    expect(rolloverCarryCore(0, 300)).toBe(0);
    expect(rolloverCarryCore(undefined, 300)).toBe(0);
  });

  it('un exceso mayor al limite deja la categoria en 0, no en negativo', () => {
    expect(catLimitWithCarryCore(50, -120, true)).toBe(0);
  });

  it('apagado, el limite es el asignado y nada mas', () => {
    expect(catLimitWithCarryCore(450, 50, false)).toBe(450);
  });

  it('una categoria sin % no inventa limite por arrastre', () => {
    expect(catLimitWithCarryCore(0, 50, true)).toBe(0);
  });
});
