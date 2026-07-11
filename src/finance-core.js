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

// Flujos externos: mueven el total pero NO son ganancia (se netean del P&L).
export function isExtFlow(cat) { return cat === 'Investments' || cat === 'Transfer'; }

// Flujos externos atribuidos al periodo (prevSnap, curSnap]. Atribucion por
// momento de registro (id/timestamp) en ambos extremos; fallback por fecha para
// snapshots/txs legacy sin id.
export function investmentFlowCore(transactions, prevSnap, curSnap) {
  var lo = prevSnap ? prevSnap.date : '';
  var txs = (transactions || []).filter(function (t) {
    if (!isExtFlow(t.category)) return false;
    if (curSnap.id != null && t.id != null && t.id > curSnap.id) return false;
    if (prevSnap && prevSnap.id != null && t.id != null) {
      if (t.id <= prevSnap.id) return false;
    } else {
      if (!(t.date > lo)) return false;
    }
    if ((curSnap.id == null || t.id == null) && !(t.date <= curSnap.date)) return false;
    return true;
  });
  var invOut = txs.filter(function (t) { return t.type === 'Debit'; }).reduce(function (a, t) { return a + t.amountUSD; }, 0);
  var invIn = txs.filter(function (t) { return t.type === 'Credit'; }).reduce(function (a, t) { return a + t.amountUSD; }, 0);
  return { invOut: invOut, invIn: invIn };
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
