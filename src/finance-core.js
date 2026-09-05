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

// Total de presupuesto efectivo de un mes: override del mes > default global.
// Mismo contrato que catBudgetPctCore (los dos ejes del budget — cuanto hay y
// como se reparte — se resuelven igual), y por eso mismo los meses ya cerrados
// no se mueven cuando cambia el default.
export function budgetTotalForCore(globalTotal, byMonth, month) {
  var o = (byMonth || {})[month];
  if (o != null) return o;
  return globalTotal != null ? globalTotal : 0;
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

// Deudas. Un wallet tracker puede ser tres cosas: una wallet normal cuyo balance
// sale de las txs (debt ausente), plata que te deben (debt:'in') o plata que debes
// (debt:'out'). Los tres guardan un numero positivo y se mueven con la MISMA regla:
// Debit baja el saldo, Credit lo sube (lo que ya hace trackerTxBalancesCore). El
// signo aparece recien aca — solo lo que debes resta.
// Los trackers sin marcar salen en `cash`: son bancos y wallets propias (Mercantil,
// Zinli, una tarjeta prepaga), plata que puedes gastar hoy. Antes caian en
// receivable — herencia de cuando el unico tracker posible era una deuda a favor —
// y el KPI Liquid restaba plata que si es liquida.
// `balances` es {nombre: saldo ya resuelto} — override si lo hay, si no base+txs.
// El patrimonio es cash + receivable - owed: mover un tracker de bucket no lo mueve.
export function debtSplitCore(manualWallets, balances) {
  var cash = 0, receivable = 0, owed = 0;
  (manualWallets || []).forEach(function (w) {
    if (!w.trackerOnly) return;
    var v = (balances || {})[w.name] || 0;
    if (w.debt === 'out') owed += v;
    else if (w.debt === 'in') receivable += v;
    else cash += v;
  });
  return { cash: parseFloat(cash.toFixed(2)), receivable: parseFloat(receivable.toFixed(2)), owed: parseFloat(owed.toFixed(2)) };
}

// Rollover: lo que sobro (o falto) en una categoria el mes pasado se arrastra al
// limite de este. Sobrante suma, exceso resta — un sobre de verdad, no un reset
// mensual. Sin limite el mes anterior no hay nada que arrastrar: el mes recien
// asignado arranca limpio en vez de heredar un "sobrante" igual a todo su gasto.
// Arrastra UN mes, no encadena: el limite de marzo mira el sobrante de febrero,
// no el de enero acumulado.
// Que anotaste la ULTIMA vez con esta misma descripcion. Reemplaza tener que
// mantener a mano una lista de palabras clave (AUTOFILL_RULES): cada comercio
// nuevo se aprende solo la primera vez que lo anotas, y si le cambiaste la
// categoria a algo, la proxima ya sale con la nueva.
// Primero coincidencia exacta; si no hay, la mas reciente que EMPIEZA igual, y
// solo desde 3 caracteres — con menos, escribir "u" fliparia los campos a la
// primera tx que empiece con u mientras seguis tecleando.
// "Mas reciente" por fecha y despues por alta, nunca por posicion en el array:
// mergeTxArrays reordena y el orden del array no dice nada.
export function noteMemoryCore(transactions, note) {
  var norm = function (v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  var q = norm(note);
  if (!q) return null;
  var newer = function (a, b) {
    if (!b) return true;
    if ((a.date || '') !== (b.date || '')) return (a.date || '') > (b.date || '');
    return (a.createdAt || 0) > (b.createdAt || 0);
  };
  var exact = null, pref = null;
  (transactions || []).forEach(function (t) {
    var d = norm(t.desc);
    if (!d || (!t.category && !t.wallet)) return;
    if (d === q) { if (newer(t, exact)) exact = t; return; }
    if (q.length >= 3 && d.indexOf(q) === 0 && newer(t, pref)) pref = t;
  });
  var hit = exact || pref;
  if (!hit) return null;
  return {
    exact: hit === exact,
    category: hit.category || '',
    wallet: hit.wallet || '',
    type: hit.type || '',
    currency: hit.originalCurrency || '',
  };
}

// Desde cuando existe la deuda que hay HOY: la fecha en que el saldo dejo de ser
// cero por ultima vez. No la tx mas vieja del tracker — en una wallet de ciclo
// (prestas, te pagan, volves a prestar) esa fecha es de una deuda ya saldada y
// diria "hace dos años" sobre plata que prestaste ayer.
// null si no se puede saber: saldo cero (no hay deuda) o un balance base
// distinto de cero, que es plata que ya existia antes del primer movimiento.
export function debtSinceCore(transactions, wallet, base) {
  var z = function (v) { return Math.abs(v) < 0.005; };
  if (!z(base || 0)) return null;
  var txs = (transactions || [])
    .filter(function (t) { return !t.imported && t.wallet === wallet; })
    .sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0);
    });
  var run = 0, since = null;
  txs.forEach(function (t) {
    var was = run;
    run += (t.type === 'Credit' ? 1 : -1) * (t.amountUSD || 0);
    if (z(run)) since = null;
    else if (z(was)) since = t.date;
  });
  return z(run) ? null : since;
}

// Dias transcurridos entre dos fechas ISO (YYYY-MM-DD), a mediodia UTC para que
// un cambio de horario de verano no sume ni reste un dia.
export function daysBetweenISO(from, to) {
  if (!from || !to) return null;
  var d = (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000;
  return isFinite(d) ? Math.round(d) : null;
}

export function rolloverCarryCore(prevLimit, prevSpent) {
  if (!(prevLimit > 0)) return 0;
  return parseFloat((prevLimit - (prevSpent || 0)).toFixed(2));
}

// Limite efectivo del mes: el asignado por % mas el arrastre. Nunca baja de 0 —
// un exceso mayor al limite dejaria la categoria en negativo, que no se puede
// gastar ni dibujar en una barra.
// Rollover por MES: solo arrastra lo que este marcado para ese mes concreto.
// Antes el mapa era plano ({cat:false} = excepcion) y valia para todos los meses,
// asi que encender una categoria la encendia tambien en los meses ya cerrados.
export function rollOnCore(rolloverByMonth, cat, month) {
  var m = (rolloverByMonth || {})[month];
  return !!(m && m[cat] === true);
}

// Pasa el mapa plano viejo al nuevo por-mes. Lo que estaba encendido (todo menos
// las excepciones en false) queda encendido SOLO en `month`: los meses anteriores
// arrancan apagados, que era el comportamiento que sobraba. Idempotente: si ya
// tiene forma nueva (valores objeto) lo devuelve tal cual.
export function migrateRolloverCore(cur, cats, month) {
  var keys = Object.keys(cur || {});
  if (keys.some(function (k) { return cur[k] && typeof cur[k] === 'object'; })) return cur;
  var m = {};
  (cats || []).forEach(function (c) { if ((cur || {})[c] !== false) m[c] = true; });
  var out = {};
  if (Object.keys(m).length) out[month] = m;
  return out;
}

// Reparte el presupuesto de un mes segun el gasto promedio real por categoria.
// null cuando no hay con que: sin historial (o sin total) no hay recomendacion
// que dar, y es preferible dejar el mes en blanco a inventarle un plan.
export function histAllocPctCore(avgByCat, total) {
  if (!(total > 0)) return null;
  var out = {}, any = false;
  Object.keys(avgByCat || {}).forEach(function (c) {
    var v = avgByCat[c];
    if (!(v > 0)) return;
    var p = parseFloat((v / total * 100).toFixed(1));
    if (p > 0) { out[c] = p; any = true; }
  });
  return any ? out : null;
}

export function catLimitWithCarryCore(baseLimit, carry, on) {
  if (!on || !(baseLimit > 0)) return parseFloat((baseLimit || 0).toFixed(2));
  return parseFloat(Math.max(0, baseLimit + carry).toFixed(2));
}

// Proyeccion de fin de mes de una categoria: al ritmo de lo que va del mes, cuanto
// vas a terminar gastando. Devuelve null cuando la pregunta no tiene sentido (sin
// limite asignado, o sin dias transcurridos que definan un ritmo).
export function catPaceCore(spent, limit, dayOfMonth, daysInMonth) {
  if (!(limit > 0) || !(dayOfMonth > 0) || !(daysInMonth > 0)) return null;
  var projected = parseFloat(((spent || 0) / dayOfMonth * daysInMonth).toFixed(2));
  return { projected: projected, over: parseFloat((projected - limit).toFixed(2)) };
}

// Vale la pena avisar? Solo si el aviso todavia sirve para algo: la categoria aun
// NO se paso (si ya se paso, la card lo grita y el aviso llega tarde), el mes lleva
// dias suficientes como para que el ritmo no sea ruido, y la proyeccion supera el
// limite por un margen que no sea redondeo.
export function catPaceAlertCore(spent, limit, dayOfMonth, daysInMonth) {
  var p = catPaceCore(spent, limit, dayOfMonth, daysInMonth);
  if (!p) return null;
  if (dayOfMonth < 8) return null;
  if (!(spent > 0) || spent >= limit) return null;
  if (p.projected <= limit * 1.05) return null;
  return { projected: p.projected, over: p.over, sev: p.projected > limit * 1.3 ? 'crit' : 'warn' };
}

// Meses que ofrece el selector del Dashboard. NO alcanza con los meses que tienen
// transacciones: el Dashboard vive de snapshots y del mes en curso, asi que quien
// no cargo ninguna tx este mes se quedaba trabado en el ultimo mes que si tenia,
// sin manera de volver al actual. (El Budget y el filtro de Transacciones ya
// sumaban el mes en curso por su cuenta; el Dashboard era el unico que no.)
export function dashMonthsCore(txMonths, snapshots, nowMonth) {
  var seen = {}, out = [];
  (txMonths || [])
    .concat((snapshots || []).map(function (s) { return String(s.date || '').slice(0, 7); }))
    .concat([nowMonth])
    .forEach(function (m) {
      if (!m || seen[m]) return;
      seen[m] = 1; out.push(m);
    });
  return out.sort().reverse();
}


// Transacciones sin categoria de un mes. Una tx asi baja el patrimonio pero no
// aparece en el budget, ni en Spent, ni en el donut, ni en la tabla del cierre:
// las metricas de gasto suman por lista de categorias, y la vacia no esta en
// ninguna. El unico rastro es la linea "Unexplained" del cierre, que dice cuanto
// falta pero no cual fue. Contarlas es el primer paso para poder arreglarlas.
export function uncategorizedCore(transactions, month) {
  var n = 0, debit = 0;
  (transactions || []).forEach(function (t) {
    if (!t || !t.date || t.date.slice(0, 7) !== month) return;
    if (t.category) return;
    n++;
    if (t.type === 'Debit') debit += t.amountUSD || 0;
  });
  return { n: n, debit: parseFloat(debit.toFixed(2)) };
}


// Wallet de la ultima transaccion tuya. El default del form estaba clavado en
// 'Binance', asi que cada tx nueva arrancaba ahi aunque llevaras meses gastando
// con otra. Se ignoran las importadas y las que genera una regla recurrente: no
// son un gesto tuyo y arrastrarian el default al wallet de la regla.
export function lastWalletCore(transactions) {
  var best = null;
  (transactions || []).forEach(function (t) {
    if (!t || !t.wallet || t.imported || t.auto) return;
    if (!best) { best = t; return; }
    if ((t.date || '') !== (best.date || '')) { if ((t.date || '') > (best.date || '')) best = t; return; }
    if ((t.createdAt || 0) > (best.createdAt || 0)) best = t;
  });
  return best ? best.wallet : null;
}

// Posible duplicado: misma descripcion y mismo monto dentro de una ventana de
// dias. Con reglas recurrentes generando txs solas es facil anotar a mano algo
// que la app ya anoto, y eso solo se descubre cuadrando el mes.
export function dupTxCore(transactions, tx, days) {
  var norm = function (v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  var q = norm(tx && tx.desc);
  if (!q || !tx || !(tx.amountUSD > 0) || !tx.date) return null;
  var win = (days == null ? 3 : days);
  var found = null;
  (transactions || []).forEach(function (t) {
    if (found || !t || t.id === tx.id) return;
    if (norm(t.desc) !== q) return;
    if (Math.abs((t.amountUSD || 0) - tx.amountUSD) >= 0.005) return;
    var d = daysBetweenISO(t.date, tx.date);
    if (d == null || Math.abs(d) > win) return;
    found = t;
  });
  return found;
}
