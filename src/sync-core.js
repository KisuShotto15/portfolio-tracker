// Pure, DOM-free sync/merge/recurring helpers.
// Imported by main.js (single source of truth) and unit-tested in sync-core.test.js.
// Keep this file free of `document`, `window`, S, fetch — only pure functions.

// Monotonic logical clock step: never goes backwards relative to what we've seen,
// so a skewed wall clock can't make a newer edit lose the last-writer-wins compare.
export function nextStamp(prev, now){ return Math.max(now, (prev || 0) + 1); }

// Highest timestamp observed anywhere in a state doc (its TS fields + every tx's
// updatedAt). Used to seed the logical clock past anything local or cloud has seen.
export function maxObservedStamp(o, tsFields){
  if(!o) return 0;
  var ts = 0;
  tsFields.forEach(function(k){ if((o[k] || 0) > ts) ts = o[k] || 0; });
  if(Array.isArray(o.transactions)) o.transactions.forEach(function(t){ if((t.updatedAt || 0) > ts) ts = t.updatedAt || 0; });
  return ts;
}

// On pull: keep the local value of a timestamped field only when it is strictly
// newer than cloud — never clobber an edit this device made but hasn't pushed yet.
export function localFieldWins(cloudTs, localTs){ return (cloudTs || 0) < (localTs || 0); }

// VES amount → USD at the given rate, rounded to 4 decimals (matches tx storage).
// rate no finito o <=0 (dato corrupto/cero) → 0 en vez de Infinity/NaN.
export function vesToUsd(amountVES, rate){ if(!isFinite(rate) || rate <= 0) return 0; return parseFloat((amountVES / rate).toFixed(4)); }

// ── Tombstones ──────────────────────────────────────────────────────────────
// Entrada legacy: id numerico (borrado irrevocable, comportamiento viejo).
// Entrada nueva: {id, ts} con ts = stamp() del borrado. Una tx restaurada por
// undo lleva updatedAt > ts y le GANA al tombstone en el merge: sin esto, el
// servidor unia tombstones de ambos lados y el undo de un borrado se revertia
// solo (la tx volvia 1s y desaparecia al adoptar el doc merged).
export function tombId(e){ return (e && typeof e === 'object') ? e.id : e; }
// null = legacy sin timestamp: mata siempre (los borrados viejos siguen borrados).
export function tombTs(e){ return (e && typeof e === 'object') ? (e.ts || 0) : null; }

// Une dos listas de tombstones por id; ante duplicados gana el de ts mayor
// (legacy cuenta como infinito).
export function mergeTombstones(a, b){
  var by = {}, order = [];
  (a || []).concat(b || []).forEach(function(e){
    var id = tombId(e);
    if(!(id in by)){ by[id] = e; order.push(id); return; }
    var pts = tombTs(by[id]), ets = tombTs(e);
    if(pts === null) return;                       // el existente es legacy: ya gana
    if(ets === null || ets > pts) by[id] = e;
  });
  return order.map(function(id){ return by[id]; });
}

// true si el tombstone mata a la tx: legacy siempre; con ts, solo si el borrado
// es igual o mas nuevo que la ultima edicion de la tx (empate: gana el borrado).
export function tombKills(e, tx){
  var ts = tombTs(e);
  return ts === null || ts >= (tx.updatedAt || 0);
}

// Tras el merge, todo tombstone cuya tx sigue viva fue revocado (la tx solo
// sobrevive si le gano); quitarlo para que no la mate en merges futuros.
export function pruneRevokedTombstones(tombs, txs){
  var live = {};
  txs.forEach(function(t){ live[t.id] = 1; });
  return (tombs || []).filter(function(e){ return !live[tombId(e)]; });
}

// Merge two transaction arrays using per-transaction last-writer-wins (updatedAt).
// Cloud version of a tx wins unless local has a strictly higher updatedAt.
// Local-only transactions (not in cloud) are always preserved. `tombs` es la
// lista de tombstones ya unida (mergeTombstones); cada tx se compara contra su
// tombstone via tombKills, asi un undo (updatedAt mas nuevo) resucita la tx.
export function mergeTxArrays(localTxs, cloudTxs, tombs){
  var tm = {};
  (tombs || []).forEach(function(e){ tm[tombId(e)] = e; });
  function killed(t){ var e = tm[t.id]; return e !== undefined && tombKills(e, t); }
  var localById = {}, cloudById = {};
  localTxs.forEach(function(t){ localById[t.id] = t; });
  cloudTxs.forEach(function(t){ cloudById[t.id] = t; });
  var merged = [];
  cloudTxs.forEach(function(t){
    var local = localById[t.id];
    var win = (local && (local.updatedAt || 0) > (t.updatedAt || 0)) ? local : t;
    if(!killed(win)) merged.push(win);
  });
  localTxs.forEach(function(t){
    if(!cloudById[t.id] && !killed(t)) merged.push(t);
  });
  return merged;
}

// Months a recurring rule is due to run, given "now". Starts the month after
// lastRun (or the current month on first run), catches up missed months, and
// clamps the scheduled day to each month's last day. Skips the current month
// until its scheduled day has arrived.
export function dueMonths(rule, now){
  var out = [], cursor;
  if(rule.lastRun){ var p = rule.lastRun.split('-'); cursor = new Date(+p[0], (+p[1] - 1) + 1, 1); }
  else { cursor = new Date(now.getFullYear(), now.getMonth(), 1); }
  var end = new Date(now.getFullYear(), now.getMonth(), 1), guard = 0;
  while(cursor <= end && guard++ < 240){
    var y = cursor.getFullYear(), m = cursor.getMonth();
    var lastDay = new Date(y, m + 1, 0).getDate();
    var dom = Math.min(rule.dayOfMonth || 1, lastDay);
    var isCur = (y === now.getFullYear() && m === now.getMonth());
    if(!isCur || now.getDate() >= dom){ out.push({ y: y, m: m, dom: dom, ym: y + '-' + String(m + 1).padStart(2, '0') }); }
    cursor = new Date(y, m + 1, 1);
  }
  return out;
}

// Una tx recurrente snapshotea r.wallet en el momento de generarse. Si la regla
// todavia no tenia wallet (o la genero un dispositivo con una copia vieja de la
// regla), la tx queda con wallet:'' y NUNCA se debita del tracker — aunque
// despues arregles la regla, la tx ya creada sigue rota para siempre.
// Backfill: rellena SOLO txs recurrentes sin wallet cuya regla hoy si tiene uno.
// Un wallet vacio no es elegible en el select, asi que nunca es una eleccion
// deliberada del usuario: esto no pisa ediciones manuales. Devuelve las txs
// tocadas para que el caller les ponga updatedAt (y el merge las propague).
export function backfillRecurringTxWallets(recurring, transactions){
  var byRule = {};
  (recurring || []).forEach(function(r){ if(r && r.wallet) byRule[r.id] = r.wallet; });
  var fixed = [];
  (transactions || []).forEach(function(t){
    if(!t || t.wallet || t.recurringId == null) return;
    var w = byRule[t.recurringId];
    if(w){ t.wallet = w; fixed.push(t); }
  });
  return fixed;
}
