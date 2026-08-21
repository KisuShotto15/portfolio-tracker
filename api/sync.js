// ── Tombstones (espejo del cliente en src/sync-core.js) ─────────────────────
// Legacy: id numerico = borrado irrevocable. Nuevo: {id, ts} = borrado con
// stamp; una tx restaurada por undo (updatedAt > ts) le gana al tombstone.
export function tombId(e) { return (e && typeof e === 'object') ? e.id : e; }
export function tombTs(e) { return (e && typeof e === 'object') ? (e.ts || 0) : null; }
export function mergeTombstones(a, b) {
  var by = {}, order = [];
  (a || []).concat(b || []).forEach(function (e) {
    var id = tombId(e);
    if (!(id in by)) { by[id] = e; order.push(id); return; }
    var pts = tombTs(by[id]), ets = tombTs(e);
    if (pts === null) return;
    if (ets === null || ets > pts) by[id] = e;
  });
  return order.map(function (id) { return by[id]; });
}
export function tombKills(e, tx) {
  var ts = tombTs(e);
  return ts === null || ts >= (tx.updatedAt || 0);
}
export function pruneRevokedTombstones(tombs, txs) {
  var live = {};
  txs.forEach(function (t) { live[t.id] = 1; });
  return (tombs || []).filter(function (e) { return !live[tombId(e)]; });
}

// createdAt es inmutable (espejo de src/sync-core.js): si el que pierde el LWW lo
// tiene y el ganador no, se conserva. Es lo que ancla el orden de la lista al alta
// de la tx y no a su ultima edicion.
function keepCreatedAt(win, loser) {
  if (!win || win.createdAt != null || !loser || loser.createdAt == null) return win;
  return Object.assign({}, win, { createdAt: loser.createdAt });
}

// Per-transaction last-writer-wins merge (mirror of the client helper).
// Cloud version of a tx wins unless the incoming side has a strictly higher updatedAt.
export function mergeTxArrays(incomingTxs, cloudTxs, tombs) {
  var tm = {};
  (tombs || []).forEach(function (e) { tm[tombId(e)] = e; });
  function killed(t) { var e = tm[t.id]; return e !== undefined && tombKills(e, t); }
  var incomingById = {}, cloudById = {};
  incomingTxs.forEach(function (t) { incomingById[t.id] = t; });
  cloudTxs.forEach(function (t) { cloudById[t.id] = t; });
  var merged = [];
  cloudTxs.forEach(function (t) {
    var inc = incomingById[t.id];
    var win = (inc && (inc.updatedAt || 0) > (t.updatedAt || 0)) ? inc : t;
    win = keepCreatedAt(win, win === t ? inc : t);
    if (!killed(win)) merged.push(win);
  });
  incomingTxs.forEach(function (t) {
    if (!cloudById[t.id] && !killed(t)) merged.push(t);
  });
  return merged;
}

// Authoritative server-side merge: `incoming` (the client POST) overlays `cloud`.
// Untimestamped fields take the incoming value (preserves prior whole-blob behavior).
// Fields with a `<field>UpdatedAt` use last-writer-wins by timestamp so a stale
// device can never overwrite a fresher edit made elsewhere.
export function mergeDocs(cloud, incoming) {
  cloud = cloud || {};
  incoming = incoming || {};
  var out = Object.assign({}, cloud, incoming);

  // transactions: per-tx LWW + tombstones revocables (prune 90d para acotar crecimiento)
  var tombCut = Date.now() - 90 * 24 * 60 * 60 * 1000;
  // Prune: nuevos por fecha de borrado (ts), legacy por fecha de creacion (id).
  var tombs = mergeTombstones(incoming.deletedTxIds, cloud.deletedTxIds)
    .filter(function (e) { var t = (e && typeof e === 'object') ? e.ts : e; return (parseInt(t, 10) || 0) > tombCut; });
  out.transactions = mergeTxArrays(incoming.transactions || [], cloud.transactions || [], tombs);
  out.deletedTxIds = pruneRevokedTombstones(tombs, out.transactions);
  out.transactionsUpdatedAt = Math.max(incoming.transactionsUpdatedAt || 0, cloud.transactionsUpdatedAt || 0) || null;

  // Generic last-writer-wins by convention: ANY field with a sibling
  // "<field>UpdatedAt" timestamp participates automatically. Keep whichever side
  // has the higher timestamp (cloud wins ties). No hardcoded field list to drift
  // from the client — add a field with an UpdatedAt sibling and it Just Works on
  // both sides. transactions is special (per-tx merge above).
  var seen = {};
  Object.keys(cloud).concat(Object.keys(incoming)).forEach(function (k) {
    var m = /^(.+)UpdatedAt$/.exec(k);
    if (!m) return;
    var key = m[1];
    if (key === 'transactions' || seen[key]) return;
    seen[key] = 1;
    var ts = key + 'UpdatedAt';
    var cloudTs = cloud[ts] || 0, incTs = incoming[ts] || 0;
    if (cloudTs >= incTs && cloud[key] !== undefined) {
      out[key] = cloud[key];
      out[ts] = cloud[ts];
    } else if (incoming[key] !== undefined) {
      out[key] = incoming[key];
      out[ts] = incoming[ts];
    }
  });

  return out;
}

// Storage adapter: multi-usuario con Supabase. Expone readDoc()/writeDoc(doc); el
// resto del handler (read-merge-write con mergeDocs) es identico. Requiere
// SUPABASE_URL + SUPABASE_ANON_KEY y el JWT del usuario (Bearer).
async function makeStore(req, res) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Sync not configured' }); return null; }

  const jwt = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!jwt) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  // Verifica el token y obtiene el user id. El JWT lo firma Supabase; no confiamos
  // en nada que mande el cliente para identificar al usuario.
  const ur = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + jwt } });
  if (!ur.ok) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const uid = (await ur.json()).id;
  const base = SB_URL + '/rest/v1/app_state';
  // Reenviamos el JWT del usuario a PostgREST → RLS aplica de punta a punta:
  // aunque este codigo tuviera un bug, la DB no deja tocar filas ajenas.
  const h = { apikey: SB_KEY, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' };
  return {
    async readRow() {
      // Filtro explicito por user_id ADEMAS de RLS: antes la query confiaba solo en
      // la policy y tomaba rows[0]; si la policy de select fuera permisiva, cada
      // usuario leeria la fila de otro (y sus pulls pisarian lo propio). Con el
      // filtro, una policy mal configurada devuelve como mucho la fila correcta.
      // Trae updated_at como snapshot para el lock optimista del write.
      const r = await fetch(base + '?select=doc,updated_at&user_id=eq.' + encodeURIComponent(uid) + '&limit=1', { headers: h });
      if (!r.ok) throw { status: r.status };
      const rows = await r.json();
      return rows[0] || null;
    },
    async readDoc() {
      const row = await this.readRow();
      return (row && row.doc) || {};
    },
    // Escritura con lock optimista: dos pushes casi simultaneos del mismo usuario
    // hacian read-merge-write cruzado y el segundo pisaba lo que escribio el
    // primero (lost update). Ahora el UPDATE exige que updated_at siga siendo el
    // del snapshot leido (el trigger touch_updated_at lo cambia en cada write);
    // si no coincide devuelve 0 filas → false → el handler re-lee y re-mergea.
    async writeDocIf(doc, snapshotUpdatedAt) {
      if (snapshotUpdatedAt) {
        const r = await fetch(base + '?user_id=eq.' + encodeURIComponent(uid) + '&updated_at=eq.' + encodeURIComponent(snapshotUpdatedAt), {
          method: 'PATCH',
          headers: { ...h, Prefer: 'return=representation' },
          body: JSON.stringify({ doc }),
        });
        if (!r.ok) throw { status: r.status };
        return (await r.json()).length > 0;
      }
      // Sin fila previa: insert plano; 409 = otra request la creo en paralelo.
      const r = await fetch(base, {
        method: 'POST',
        headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: uid, doc }),
      });
      if (r.status === 409) return false;
      if (!r.ok) throw { status: r.status };
      return true;
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const store = await makeStore(req, res);
  if (!store) return; // makeStore ya respondio 401/500

  if (req.method === 'GET') {
    try { res.status(200).json({ data: await store.readDoc() }); }
    catch (e) { res.status(e && e.status === 401 ? 401 : 503).json({ error: 'Sync read failed, retry' }); }
    return;
  }

  if (req.method === 'POST') {
    // Read-merge-write con lock optimista: si otra request escribio entre la
    // lectura y el write, se re-lee y re-mergea (hasta 3 intentos). Si la
    // lectura falla, abortar en vez de pisar con datos viejos.
    for (let attempt = 0; attempt < 3; attempt++) {
      let row;
      try { row = await store.readRow(); }
      catch (e) { return res.status(e && e.status === 401 ? 401 : 503).json({ error: 'Sync read failed, retry' }); }

      const merged = mergeDocs((row && row.doc) || {}, req.body || {});

      try {
        if (await store.writeDocIf(merged, row && row.updated_at)) {
          return res.status(200).json({ data: merged });
        }
      } catch (e) { return res.status(e && e.status === 401 ? 401 : 503).json({ error: 'Sync write failed, retry' }); }
    }
    return res.status(503).json({ error: 'Sync conflict, retry' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
