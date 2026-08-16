// Logica financiera PURA (sin S, sin DOM): funciones deterministas testeables.
// main.js las envuelve con sus caches/estado. Cambios aqui = correr los tests.

// Totales debit/credit por 'YYYY-MM|categoria' en una pasada.
export function monthCatTotalsCore(transactions) {
  var map = {};
  (transactions || []).forEach(function (t) {
    var k = t.date.slice(0, 7) + '|' + t.category;
    var e = map[k] || (map[k] = { d: 0, c: 0 });
    if (t.type === 'Debit') e.d += t.amountUSD; else if (t.type === 'Credit') e.c += t.amountUSD;
  });
  return map;
}

// Gasto neto de un mes para un set de categorias: debits - credits, piso 0
// (un refund reduce el gasto, nunca lo vuelve negativo).
export function catNetSpendCore(map, month, cats) {
  var d = 0, c = 0;
  (cats || []).forEach(function (cat) { var e = map[month + '|' + cat]; if (e) { d += e.d; c += e.c; } });
  return Math.max(0, d - c);
}

export function monthIncomeCore(map, month) {
  var e = map[month + '|Income'];
  return e ? e.c : 0;
}

// Income que la app dedujo al tomar los snapshots de un mes. Es un dato CALCULADO
// (Δ patrimonio + gastos - lo ya registrado), no un hecho que ocurrio, por eso vive
// como campo del snapshot y no como transaccion.
// Los snapshots viejos lo guardan como tx enlazada (txId) y ya suman por
// monthIncomeCore. Invariante: un snapshot tiene txId O derivedIncome, nunca ambos,
// que es lo que evita el doble conteo sin necesidad de migrar datos.
export function snapDerivedIncomeCore(snapshots, month) {
  var total = 0;
  (snapshots || []).forEach(function (s) {
    if (!s || !s.date || s.date.slice(0, 7) !== month) return;
    if (typeof s.derivedIncome === 'number') total += s.derivedIncome;
  });
  return total;
}

// Flujos externos: mueven el total pero NO son ganancia (se netean del P&L).
export function isExtFlow(cat) { return cat === 'Investments' || cat === 'Transfer'; }

// ── Rol de cada categoria en la matematica ──────────────────────────────────
// Viven aca y no en main.js para que los tests puedan fijar las invariantes: son
// datos puros, y de ellos depende todo el calculo de income y de gasto.
export var GROUP_ESSENTIAL = ['Home', 'Groceries', 'Transport', 'Health'];
export var GROUP_BUSINESS = ['Business'];
export var GROUP_LIFESTYLE = ['Discretionary', 'Eating Out', 'Support'];

// GASTO: sale del patrimonio. recordSnapshot lo suma de vuelta para reconstruir
// el income bruto (income = Δ patrimonio + gastos).
export var EXPENSE_CATS_DASH = GROUP_ESSENTIAL.concat(GROUP_BUSINESS).concat(GROUP_LIFESTYLE);
export var BUDGET_CATS = ['Home', 'Groceries', 'Transport', 'Health', 'Business', 'Discretionary', 'Eating Out', 'Support'];

// NEUTRAS: movimientos entre activos que YA rastreas — cobrar una deuda anotada en
// una wallet tracker, pasar plata de un bolsillo a otro. El patrimonio no cambia,
// solo cambia de lugar; el efecto ocurre por el campo `wallet` de la tx, nunca por
// su categoria. Por eso no son income, ni gasto, ni flujo externo.
//
// NO AGREGAR a EXPENSE_CATS_DASH ni a BUDGET_CATS. Suena razonable ("ahorrar es una
// salida de plata"), pero rompe dos cosas de golpe y en silencio: cada movimiento
// pasa a contar como gasto, Y el income derivado se infla por ese mismo monto,
// porque recordSnapshot suma los gastos de vuelta. El test de mas abajo lo fija.
export var NEUTRAL_CATS = ['Savings'];

// ¿La tx cae en el periodo (prevSnap, curSnap]? Atribucion por momento de registro
// (id/timestamp) en ambos extremos; fallback por fecha para snapshots/txs legacy
// sin id. Compartida por investmentFlowCore y periodNetSpendCore para que ambos
// atribuyan exactamente igual.
export function txInPeriodCore(t, prevSnap, curSnap) {
  var lo = prevSnap ? prevSnap.date : '';
  if (curSnap.id != null && t.id != null && t.id > curSnap.id) return false;
  if (prevSnap && prevSnap.id != null && t.id != null) {
    if (t.id <= prevSnap.id) return false;
  } else {
    if (!(t.date > lo)) return false;
  }
  if ((curSnap.id == null || t.id == null) && !(t.date <= curSnap.date)) return false;
  return true;
}

// Flujos externos atribuidos al periodo (prevSnap, curSnap].
export function investmentFlowCore(transactions, prevSnap, curSnap) {
  var txs = (transactions || []).filter(function (t) {
    return isExtFlow(t.category) && txInPeriodCore(t, prevSnap, curSnap);
  });
  var invOut = txs.filter(function (t) { return t.type === 'Debit'; }).reduce(function (a, t) { return a + t.amountUSD; }, 0);
  var invIn = txs.filter(function (t) { return t.type === 'Credit'; }).reduce(function (a, t) { return a + t.amountUSD; }, 0);
  return { invOut: invOut, invIn: invIn };
}

// Gasto neto (debits - credits, piso 0) de un set de categorias atribuido al
// periodo (prevSnap, curSnap]. Es catNetSpendCore pero por rango de snapshots en
// vez de por mes: sirve para reconstruir el income BRUTO de un periodo, dado que
// la variacion del patrimonio ya viene con los gastos descontados.
// Income ya registrado a mano como transaccion dentro del periodo (prevSnap, curSnap].
// Hay que restarlo del income derivado del snapshot: esa plata ya hizo subir el
// patrimonio, asi que derivarla de nuevo la contaria dos veces.
// excludeIds: ids de las txs generadas por snapshots anteriores. Son asientos
// contables (no mueven el balance de las wallets), no plata que entro en el periodo.
export function periodLoggedIncomeCore(transactions, prevSnap, curSnap, excludeIds) {
  var skip = excludeIds || {};
  var total = 0;
  (transactions || []).forEach(function (t) {
    if (t.category !== 'Income' || t.type !== 'Credit') return;
    if (t.id != null && skip[t.id]) return;
    if (!txInPeriodCore(t, prevSnap, curSnap)) return;
    total += t.amountUSD;
  });
  return total;
}

export function periodNetSpendCore(transactions, prevSnap, curSnap, cats) {
  var set = {};
  (cats || []).forEach(function (c) { set[c] = 1; });
  var d = 0, c = 0;
  (transactions || []).forEach(function (t) {
    if (!set[t.category]) return;
    if (!txInPeriodCore(t, prevSnap, curSnap)) return;
    if (t.type === 'Debit') d += t.amountUSD; else if (t.type === 'Credit') c += t.amountUSD;
  });
  return Math.max(0, d - c);
}

// Valor total de Holdings: on-chain (balanceUsd ya calculado) + manuales (qty x precio).
export function holdingsTotalUsdCore(walletHoldings, manualHoldings, prices) {
  var t = 0;
  (walletHoldings || []).forEach(function (h) { t += h.balanceUsd || 0; });
  var p = prices || {};
  (manualHoldings || []).forEach(function (h) { t += (h.qty || 0) * (p[h.coin] || 0); });
  return parseFloat(t.toFixed(2));
}

// % efectivo de presupuesto de una categoria para un mes: override del mes > global.
export function catBudgetPctCore(globalPcts, byMonth, cat, month) {
  var o = (byMonth || {})[month];
  if (o && o[cat] != null) return o[cat];
  var g = (globalPcts || {})[cat];
  return g != null ? g : 0;
}

// Balance por-wallet-tracker derivado de las txs (Credit suma, Debit resta;
// imported se ignora). Ante nombres duplicados, si CUALQUIER entrada es tracker
// las txs cuentan (tracker gana sobre manual).
export function trackerTxBalancesCore(manualWallets, transactions) {
  var trk = {};
  (manualWallets || []).forEach(function (w) { trk[w.name] = trk[w.name] || w.trackerOnly === true; });
  var map = {};
  (transactions || []).forEach(function (t) {
    if (t.imported || !t.wallet || !trk[t.wallet]) return;
    map[t.wallet] = (map[t.wallet] || 0) + (t.type === 'Credit' ? 1 : -1) * t.amountUSD;
  });
  return map;
}
