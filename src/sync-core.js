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

// Momento de ALTA de una tx — nunca el de su ultima edicion. El orden de la lista
// sale de aca: adjuntarle una foto a una tx de la manana no puede mandarla al tope
// como si la acabaras de anotar.
//   - manual/importada: el id ES el Date.now() del alta.
//   - recurrente: el id es DETERMINISTICO (dia + ruleId) para poder revocar
//     tombstones entre dispositivos, asi que no dice nada de cuando se genero; ahi
//     el unico rastro del alta es el updatedAt con el que nacio.
// createdAt explicito gana siempre: una vez congelado, ninguna edicion lo mueve.
export function txCreatedAt(t){
  if(!t) return 0;
  if(t.createdAt != null) return t.createdAt;
  if(t.recurringId != null || t.auto) return t.updatedAt || t.id || 0;
  return t.id || t.updatedAt || 0;
}

// Congela createdAt en las txs que no lo tienen (todas las anteriores a este
// cambio). Idempotente y derivado solo de campos que ya se sincronizan, asi que
// cada dispositivo calcula el MISMO valor sin necesidad de propagarlo.
// No toca updatedAt a proposito: hacerlo reordenaria todo otra vez y pelearia
// contra el merge.
export function backfillTxCreatedAt(txs){
  var n = 0;
  (txs || []).forEach(function(t){ if(t && t.createdAt == null){ t.createdAt = txCreatedAt(t); n++; } });
  return n;
}

// Merge two transaction arrays using per-transaction last-writer-wins (updatedAt).
// Cloud version of a tx wins unless local has a strictly higher updatedAt.
// Local-only transactions (not in cloud) are always preserved. `tombs` es la
// lista de tombstones ya unida (mergeTombstones); cada tx se compara contra su
// tombstone via tombKills, asi un undo (updatedAt mas nuevo) resucita la tx.
// createdAt es inmutable: si el que pierde el LWW lo tiene y el ganador no (copia
// vieja, o un dispositivo que todavia no actualizo), se conserva. Perderlo mandaria
// la fila de vuelta a ordenarse por su ultima edicion.
function keepCreatedAt(win, loser){
  if(!win || win.createdAt != null || !loser || loser.createdAt == null) return win;
  return Object.assign({}, win, { createdAt: loser.createdAt });
}
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
    win = keepCreatedAt(win, win === t ? local : t);
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

// El mes que hay que marcar como YA CORRIDO al crear (o al mover de dia) una
// regla, para que no genere una transaccion con fecha atrasada: crear el dia 20
// una regla de dia 5 insertaba en el acto una tx fechada el 5 de este mes, como
// si la regla hubiera existido todo el mes. Solo se salta el mes en curso cuando
// el dia YA paso; creada el mismo dia si corre (esa no es una fecha atrasada).
// Devuelve 'YYYY-MM' o null (null = no hay nada que saltear).
export function seedLastRun(dayOfMonth, now){
  var y = now.getFullYear(), m = now.getMonth();
  var lastDay = new Date(y, m + 1, 0).getDate();
  var dom = Math.min(dayOfMonth || 1, lastDay);
  return now.getDate() > dom ? y + '-' + String(m + 1).padStart(2, '0') : null;
}

// Una tx recurrente snapshotea r.wallet en el momento de generarse. Si la regla
// todavia no tenia wallet (o la genero un dispositivo con una copia vieja de la
// regla), la tx queda con wallet:'' y NUNCA se debita del tracker — aunque
// despues arregles la regla, la tx ya creada sigue rota para siempre.
// Backfill: rellena SOLO txs recurrentes sin wallet cuya regla hoy si tiene uno.
// Un wallet vacio no es elegible en el select, asi que nunca es una eleccion
// deliberada del usuario: esto no pisa ediciones manuales. Devuelve las txs
// tocadas para que el caller les ponga updatedAt (y el merge las propague).
// Una tx (y una regla recurrente) apunta a su wallet por NOMBRE, no por id: el
// saldo de un tracker sale de sumar las txs cuyo `wallet` coincide exacto. Por eso
// renombrar la wallet sin reetiquetarlas las deja huerfanas — el saldo cae a su
// base y el patrimonio cambia solo, sin ningun aviso.
// Devuelve las txs tocadas para que el caller les ponga updatedAt (y el merge
// propague el renombre al resto de dispositivos, en vez de que una copia vieja lo
// revierta). Compara exacto a proposito: 'emily' y 'Emily' son wallets distintas
// para el resto del codigo, asi que aca tambien.
// Devuelve tambien las reglas tocadas (no solo cuantas): ahora que recurring se
// mergea por item, cada regla reetiquetada necesita su propio updatedAt.
export function renameWalletRefsCore(transactions, recurring, oldName, newName){
  var out = { txs: [], rules: [] };
  if(!oldName || !newName || oldName === newName) return out;
  (transactions || []).forEach(function(t){
    if(t && t.wallet === oldName){ t.wallet = newName; out.txs.push(t); }
  });
  (recurring || []).forEach(function(r){
    if(r && r.wallet === oldName){ r.wallet = newName; out.rules.push(r); }
  });
  return out;
}

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

// ── Merge por-item generico ─────────────────────────────────────────────────
// Reemplazar una lista entera por un solo timestamp de campo pierde datos: si dos
// dispositivos agregan algo distinto sin conexion, el que tiene la marca mas vieja
// pierde su lista COMPLETA y lo que agrego desaparece sin aviso. Estas funciones
// unen las listas item por item, igual que ya se hacia con las transacciones.
// Requisitos del item: una clave estable (keyOf) y un `updatedAt` propio.
// Ante empate gana la nube, el mismo criterio que mergeTxArrays.
export function itemId(x){ return x && x.id; }

// updatedAt por item para los datos viejos, que no lo tienen. Se congela en el id
// (el Date.now del alta): es el MISMO valor en todos los dispositivos, asi que el
// relleno nunca le gana por accidente a una edicion real (que lleva stamp()).
export function backfillUpdatedAt(items){
  var n = 0;
  (items || []).forEach(function(x){ if(x && x.updatedAt == null){ x.updatedAt = x.id || 0; n++; } });
  return n;
}

export function mergeByKey(localItems, cloudItems, tombs, keyOf){
  var tm = {};
  (tombs || []).forEach(function(e){ tm[tombId(e)] = e; });
  var order = [], by = {};
  function put(it, isCloud){
    var k = keyOf(it);
    if(k === undefined || k === null || k === '') return;
    var cur = by[k];
    if(cur === undefined){ by[k] = it; order.push(k); return; }
    var a = it.updatedAt || 0, b = cur.updatedAt || 0;
    if(a > b || (a === b && isCloud)) by[k] = it;
  }
  (localItems || []).forEach(function(it){ if(it) put(it, false); });
  (cloudItems || []).forEach(function(it){ if(it) put(it, true); });
  return order.map(function(k){ return by[k]; })
    .filter(function(it){ var e = tm[keyOf(it)]; return !(e !== undefined && tombKills(e, it)); });
}

// Un item recreado despues de su borrado (updatedAt > ts) revoca el tombstone;
// sacarlo evita que lo mate en merges futuros.
export function pruneRevokedByKey(tombs, items, keyOf){
  var live = {};
  (items || []).forEach(function(x){ live[keyOf(x)] = 1; });
  return (tombs || []).filter(function(e){ return !live[tombId(e)]; });
}

// ── Snapshots ───────────────────────────────────────────────────────────────
// La identidad de un snapshot es su FECHA, no su id. La app ya garantiza uno por
// dia (recordSnapshot reemplaza el del dia; autoSnapshotDueCore no repite fecha),
// y dos dispositivos que anotan el mismo dia generan ids distintos (Date.now) para
// la misma cosa: mergeando por id quedarian dos snapshots del mismo dia, con un
// periodo de cero dias entre ellos. Por fecha, se unen en uno solo.
export function snapKey(s){ return s && s.date; }
export function backfillSnapUpdatedAt(snaps){ return backfillUpdatedAt(snaps); }
export function mergeSnapArrays(localSnaps, cloudSnaps, tombs){ return mergeByKey(localSnaps, cloudSnaps, tombs, snapKey); }
export function pruneRevokedSnapTombs(tombs, snaps){ return pruneRevokedByKey(tombs, snaps, snapKey); }

// ── Wallets ─────────────────────────────────────────────────────────────────
// Las wallets SI se mergean por id: el nombre cambia (renombrar es una operacion
// normal) y usarlo de clave partiria la wallet renombrada en dos. Pero el id lo
// genera cada dispositivo con Date.now, asi que crear "Ahorros" en el telefono y
// en la compu deja dos filas para la misma wallet — y eso no es solo feo: en un
// tracker las dos suman las MISMAS txs (el saldo sale del nombre) y en un exchange
// las dos traen el mismo balance de la API. El patrimonio se duplica en silencio.
// Por eso, despues del merge por id, se colapsan los duplicados por su clave
// natural: el nombre en las wallets, la direccion en las on-chain.
// Gana la de updatedAt mas alto y, ante empate, la de id mas chico (la que se creo
// primero): el criterio no depende del orden de la lista, asi que cliente y
// servidor llegan al mismo resultado sin hablarse.
export function walletNameKey(w){ return String((w && w.name != null) ? w.name : '').trim().toLowerCase(); }
export function onchainAddrKey(w){ return String((w && w.address != null) ? w.address : '').trim().toLowerCase(); }
export function dedupeByNaturalKey(items, keyOf){
  var by = {}, order = [];
  (items || []).forEach(function(it){
    if(!it) return;
    var k = keyOf(it);
    if(!k){ order.push(it); return; }            // sin clave natural: no se parece a ninguna otra
    if(by[k] === undefined){ by[k] = it; order.push(k); return; }
    var a = it.updatedAt || 0, b = by[k].updatedAt || 0;
    if(a > b || (a === b && (it.id || 0) < (by[k].id || 0))) by[k] = it;
  });
  return order.map(function(k){ return typeof k === 'string' ? by[k] : k; });
}

// ── Restaurar un backup ─────────────────────────────────────────────────────
// Restaurar tiene que ser una vuelta atras de verdad. Reemplazar el estado local
// no alcanza: el merge conserva POR DISENO todo item que exista en la nube y no
// en lo que llega, asi que lo anotado despues del backup volvia solo en el
// siguiente pull — el dialogo decia "reemplaza todos los datos" y no borraba nada.
// Devuelve, por lista, las lapidas de lo que hay en el dispositivo y NO en el
// archivo. Una lista que el archivo no trae (backup viejo, anterior a esa
// funcion) no se toca: ahi no hay forma de saber si estaba vacia o no existia.
// Lo que solo vive en OTRO dispositivo y nunca llego hasta aca no se puede
// lapidar: no aparece ni en el archivo ni en el estado local.
export function restoreTombstonesCore(local, file, lists, ts){
  var out = {};
  (lists || []).forEach(function(L){
    if(!Array.isArray(file[L.field])) return;
    var keep = {};
    file[L.field].forEach(function(it){ var k = L.keyOf(it); if(k != null && k !== '') keep[k] = 1; });
    var tombs = [], seen = {};
    ((local && local[L.field]) || []).forEach(function(it){
      var k = L.keyOf(it);
      if(k == null || k === '' || keep[k] || seen[k]) return;
      seen[k] = 1;
      tombs.push({ id: k, ts: ts });
    });
    if(tombs.length) out[L.tomb] = tombs;
  });
  return out;
}

// ── Cuando el pull automatico puede correr ──────────────────────────────────
// La bajada automatica se salta mientras haya cambios locales sin subir. La
// intencion es correcta (bajar podria pisar lo que todavia no subio), pero no
// tenia salida: un dispositivo que no logra subir — token roto, red rara, un
// conflicto que se repite — dejaba de bajar TODO lo que pasaba en los demas, para
// siempre, sin decir por que.
// Ahora hay salida: mientras el push es normal (debounce de 1.5s) seguimos sin
// bajar, pero si lleva minutos fallando se baja igual. El merge conserva lo local
// mas nuevo (LWW por campo, por-item en las listas, tombstones en los borrados),
// asi que bajar no pisa lo que este dispositivo todavia no subio.
// ── Ritmo del pull automatico ───────────────────────────────────────────────
// Cada pull es una invocacion de la serverless function. Con la pestana abierta
// todo el dia, 25s fijos son ~1.100 llamadas por dispositivo por dia aunque no
// cambie nada — y ese numero se multiplica por cada dispositivo que se suma.
// Se espacia mientras la nube viene sin novedades (25s, 50s, 100s... hasta 5 min)
// y vuelve al ritmo corto apenas algo cambia, se edita local, o el usuario vuelve
// a la pestana. Lo que se pierde es latencia cuando NADA esta pasando.
export var PULL_BASE_MS = 25000;
export var PULL_MAX_MS = 5 * 60 * 1000;
export function nextPullDelayCore(quietRounds, base, max) {
  var b = base || PULL_BASE_MS, m = max || PULL_MAX_MS;
  var n = Math.max(0, Math.min(quietRounds || 0, 20));   // cap: 2^n desborda rapido
  return Math.min(b * Math.pow(2, n), m);
}

export const STUCK_PUSH_MS = 2 * 60 * 1000;
export function autoPullAllowedCore(st, now, stuckMs){
  if(!st || st.inFlight || st.hidden || !st.online) return false;
  if(!st.dirty && !st.syncFailed) return true;
  if(!st.failingSince) return false;                       // el push todavia no fallo: es el debounce normal
  return (now - st.failingSince) >= (stuckMs || STUCK_PUSH_MS);
}
