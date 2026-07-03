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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const apiSecret = process.env.API_SECRET;
  if (!apiSecret || req.headers['x-api-secret'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dataUrl = process.env.DATA_URL;
  const dataToken = process.env.DATA_TOKEN;
  if (!dataUrl || !dataToken) return res.status(500).json({ error: 'Sync not configured' });

  const headers = { 'Authorization': 'Bearer ' + dataToken };

  if (req.method === 'GET') {
    const r = await fetch(dataUrl + '/data', { headers });
    const body = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').end(body);
    return;
  }

  if (req.method === 'POST') {
    // Read current cloud doc, merge the incoming state into it, write back.
    // If the read fails (backend hiccup), abort instead of clobbering with stale data.
    let cloud = {};
    const gr = await fetch(dataUrl + '/data', { headers });
    if (gr.ok) {
      const gj = await gr.json().catch(function () { return null; });
      cloud = (gj && gj.data) || {};
    } else if (gr.status !== 404) {
      return res.status(503).json({ error: 'Sync read failed, retry' });
    }

    const merged = mergeDocs(cloud, req.body || {});

    const pr = await fetch(dataUrl + '/data', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });
    if (!pr.ok) {
      const body = await pr.text();
      res.status(pr.status).setHeader('Content-Type', 'application/json').end(body);
      return;
    }
    // Return the authoritative merged document so the client can adopt it.
    res.status(200).setHeader('Content-Type', 'application/json').json({ data: merged });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
