// Score de Salud Financiera: PURO (sin S, sin DOM), sobre una ventana MOVIL de dias.
//
// Por que ventana movil y no mes calendario: el score viejo leia el mes en curso
// (getMonthlyKPIs(monthKey(new Date()))), asi que el dia 1 caia de ~100 a ~0 y se
// "recuperaba" a medida que cargaba el mes. Aca ninguna metrica mira el mes: entre
// el 31 y el 1 la ventana se corre UN dia — entra uno nuevo, sale uno viejo — y el
// score se mueve fracciones de punto.
//
// Una metrica sin datos suficientes NO puntua 0: queda available:false, sale del
// promedio y los pesos se renormalizan sobre las que si tienen datos. Un 0 por
// falta de historial es exactamente la mentira que se esta sacando.

var DAYS_PER_MONTH = 30.4375;       // 365.25/12
var TARGET_RUNWAY_MO = 6;           // fondo de emergencia estandar: 3-6 meses (3 cae en 50 pts)
var TARGET_SAV_PCT = 20;            // regla 50/30/20
var BUDGET_FAIL_OVER = 0.5;         // 50% de sobregiro sostenido en la ventana = 0 pts
var TARGET_GROWTH_MONTHLY = 10;     // % mensual de crecimiento que vale 100 pts
var WEIGHTS = { runway:30, savings:25, budget:25, growth:20 };

// Aritmetica de fechas 100% en UTC: construir con Date.UTC y leer con toISOString
// nunca cruza el desfase local que format.js documenta (en UTC-4 el mes UTC voltea
// antes y los KPIs saltaban de mes).
export function addDaysISO(iso, n){
  var p = String(iso).split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function clamp100(v){ if(!isFinite(v)) return 0; return Math.max(0, Math.min(100, v)); }

// Un decimal solo mientras el numero sea chico: la columna de valores es angosta
// y "127.4 mo" se corta, "127 mo" no. La precision fina importa en 4.2 meses,
// no en 127.
function fmtNum(v){ return Math.abs(v) < 100 ? v.toFixed(1) : Math.round(v).toString(); }

// Ultimo snapshot con date <= iso (desempate por id). null si no hay ninguno.
// Mirar hacia atras es lo que hace que el score sea calculable para CUALQUIER
// fecha pasada sin guardar estado nuevo.
export function netWorthAt(snapshots, iso){
  var best = null;
  (snapshots || []).forEach(function(s){
    if(!s || !s.date || s.date > iso) return;
    if(!best || s.date > best.date || (s.date === best.date && (s.id || 0) > (best.id || 0))) best = s;
  });
  return best && typeof best.total === 'number' ? best.total : null;
}

export function healthScoreCore(input){
  input = input || {};
  var windowDays = input.windowDays || 90;
  var to = input.asOf;
  var from = addDaysISO(to, -(windowDays - 1));   // ventana inclusiva en ambos extremos
  var monthsInWindow = windowDays / DAYS_PER_MONTH;

  var expSet = {};
  (input.expenseCats || []).forEach(function(c){ expSet[c] = 1; });

  // Una sola pasada. No se filtra t.imported: el resto del dashboard
  // (monthCatTotalsCore) tampoco lo hace, y la consistencia importa mas.
  var exp = 0, inc = 0, extOut = 0, extIn = 0;
  (input.transactions || []).forEach(function(t){
    if(!t || !t.date || t.date < from || t.date > to) return;
    var amt = (typeof t.amountUSD === 'number' && isFinite(t.amountUSD)) ? t.amountUSD : 0;
    if(t.category === 'Income'){ if(t.type === 'Credit') inc += amt; return; }
    // Flujos externos: mueven el total pero no son ganancia (mismo criterio que isExtFlow).
    if(t.category === 'Investments' || t.category === 'Transfer'){
      if(t.type === 'Debit') extOut += amt; else if(t.type === 'Credit') extIn += amt;
      return;
    }
    if(expSet[t.category]) exp += (t.type === 'Debit' ? 1 : -1) * amt;
  });
  exp = Math.max(0, exp);   // un refund reduce el gasto, nunca lo vuelve negativo

  // Income que la app dedujo al tomar un snapshot. Vive como campo del snapshot
  // (derivedIncome), NO como transaccion, asi que el recorrido de arriba no lo ve.
  // Sin esto, Savings se cae en silencio para todo periodo cerrado con snapshot.
  // Los snapshots viejos lo guardan como tx enlazada y ya suman arriba; ninguno
  // tiene las dos cosas a la vez, por eso no hay doble conteo.
  (input.snapshots || []).forEach(function(s){
    if(!s || !s.date || s.date < from || s.date > to) return;
    if(typeof s.derivedIncome === 'number') inc += s.derivedIncome;
  });

  // Snapshot primero, live solo si NO hay ningun snapshot: misma precedencia que
  // renderKPIStrip/renderGoal/renderHealthScore. Al salir todos los puntos de la
  // misma escalera de snapshots, una serie historica es continua por construccion.
  var nwEnd = netWorthAt(input.snapshots, to);
  if(nwEnd === null && input.liveNetWorth != null) nwEnd = input.liveNetWorth;
  var nwStart = netWorthAt(input.snapshots, from);

  var metrics = [];

  // ── Colchon: cuantos meses aguantas al ritmo de gasto de la ventana ──────────
  var avgMonthlyOut = exp / monthsInWindow;
  // exp===0 ⇒ NO disponible, no 100: runway infinito significa "sin datos", no
  // "perfecto". Es la contracara del bug viejo (avgExp 0 ⇒ null ⇒ 0 pts).
  var runwayOk = avgMonthlyOut > 0 && nwEnd !== null;
  var runwayMo = runwayOk ? nwEnd / avgMonthlyOut : null;
  metrics.push({
    key:'runway', label:'Runway', weight:WEIGHTS.runway, available:runwayOk,
    // netWorth<=0 puntua 0 pero queda disponible: es senal real, no falta de datos.
    score: runwayOk ? clamp100(runwayMo / TARGET_RUNWAY_MO * 100) : 0,
    value: runwayMo,
    display: runwayOk ? fmtNum(runwayMo) + ' mo' : '—'
  });

  // ── Ahorro: cuanto del ingreso retenes ──────────────────────────────────────
  var savOk = inc > 0;
  var savRate = savOk ? (inc - exp) / inc * 100 : null;
  metrics.push({
    key:'savings', label:'Savings', weight:WEIGHTS.savings, available:savOk,
    score: savOk ? clamp100(savRate / TARGET_SAV_PCT * 100) : 0,
    value: savRate,
    display: savOk ? Math.round(savRate) + '%' : '—'
  });

  // ── Presupuesto: techo, no objetivo ─────────────────────────────────────────
  var allowed = (input.budgetTotal || 0) * monthsInWindow;   // prorrateado por dias
  var budOk = allowed > 0 && exp > 0;
  var ratio = budOk ? exp / allowed : null;
  metrics.push({
    key:'budget', label:'Budget', weight:WEIGHTS.budget, available:budOk,
    // En o bajo presupuesto ⇒ 100. Sin premio por gastar de menos: eso ya lo
    // premian Ahorro y Colchon, y premiarlo dos veces distorsiona el score.
    score: budOk ? (ratio <= 1 ? 100 : clamp100((1 - (ratio - 1) / BUDGET_FAIL_OVER) * 100)) : 0,
    value: ratio,
    display: budOk ? Math.round(ratio * 100) + '%' : '—'
  });

  // ── Crecimiento: patrimonio, neteado de flujos externos ─────────────────────
  var growOk = nwStart !== null && nwStart > 0 && nwEnd !== null;
  var gMonthly = null;
  if(growOk){
    // (nwFin - nwInicio) + salidas - entradas: identico a _computeSnapshotPnL, para
    // que meter o sacar capital no cuente como ganancia ni como perdida.
    var ratioG = (nwEnd + extOut - extIn) / nwStart;
    // Mensualizado: comparable de un vistazo contra un objetivo mensual, en vez de
    // un "+33% en 90d" que no dice nada.
    gMonthly = ratioG > 0 ? (Math.pow(ratioG, DAYS_PER_MONTH / windowDays) - 1) * 100 : -100;
  }
  metrics.push({
    key:'growth', label:'Growth', weight:WEIGHTS.growth, available:growOk,
    score: growOk ? clamp100(gMonthly / TARGET_GROWTH_MONTHLY * 100) : 0,
    value: gMonthly,
    display: growOk ? (gMonthly >= 0 ? '+' : '') + fmtNum(gMonthly) + '%/mo' : '—'
  });

  // ── Renormalizacion sobre las disponibles ───────────────────────────────────
  var W = 0;
  metrics.forEach(function(m){ if(m.available) W += m.weight; });
  metrics.forEach(function(m){ m.effWeight = (m.available && W > 0) ? m.weight / W * 100 : 0; });

  // Se redondea UNA sola vez, al final: el score viejo redondeaba cada sub-metrica
  // y acumulaba hasta 2 puntos de deriva.
  var total = null;
  if(W > 0){
    var acc = 0;
    metrics.forEach(function(m){ if(m.available) acc += m.score * m.weight; });
    total = Math.round(acc / W);
  }

  return {
    total: total,
    label: total === null ? 'Sin datos'
         : total >= 80 ? 'Excelente' : total >= 60 ? 'Bien' : total >= 40 ? 'Mejorable' : 'Atención',
    from: from, to: to, netWorth: nwEnd,
    metrics: metrics
  };
}
