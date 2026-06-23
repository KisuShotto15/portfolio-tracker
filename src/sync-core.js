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
export function vesToUsd(amountVES, rate){ return parseFloat((amountVES / rate).toFixed(4)); }

// Merge two transaction arrays using per-transaction last-writer-wins (updatedAt).
// Cloud version of a tx wins unless local has a strictly higher updatedAt.
// Local-only transactions (not in cloud) are always preserved. Deleted ids dropped.
export function mergeTxArrays(localTxs, cloudTxs, deletedSet){
  var localById = {};
  localTxs.forEach(function(t){ if(!deletedSet.has(t.id)) localById[t.id] = t; });
  var cloudById = {};
  cloudTxs.forEach(function(t){ cloudById[t.id] = t; });
  var merged = [];
  cloudTxs.forEach(function(t){
    if(deletedSet.has(t.id)) return;
    var local = localById[t.id];
    if(!local){ merged.push(t); return; }
    merged.push((local.updatedAt || 0) > (t.updatedAt || 0) ? local : t);
  });
  localTxs.forEach(function(t){
    if(!cloudById[t.id] && !deletedSet.has(t.id)) merged.push(t);
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
