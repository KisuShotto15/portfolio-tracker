// Per-transaction last-writer-wins merge (mirror of the client helper).
// Cloud version of a tx wins unless the incoming side has a strictly higher updatedAt.
function mergeTxArrays(incomingTxs, cloudTxs, deletedSet) {
  var incomingById = {};
  incomingTxs.forEach(function (t) { if (!deletedSet.has(t.id)) incomingById[t.id] = t; });
  var cloudById = {};
  cloudTxs.forEach(function (t) { cloudById[t.id] = t; });
  var merged = [];
  cloudTxs.forEach(function (t) {
    if (deletedSet.has(t.id)) return;
    var inc = incomingById[t.id];
    if (!inc) { merged.push(t); return; }
    merged.push((inc.updatedAt || 0) > (t.updatedAt || 0) ? inc : t);
  });
  incomingTxs.forEach(function (t) {
    if (!cloudById[t.id] && !deletedSet.has(t.id)) merged.push(t);
  });
  return merged;
}

// Authoritative server-side merge: `incoming` (the client POST) overlays `cloud`.
// Untimestamped fields take the incoming value (preserves prior whole-blob behavior).
// Fields with a `<field>UpdatedAt` use last-writer-wins by timestamp so a stale
// device can never overwrite a fresher edit made elsewhere.
function mergeDocs(cloud, incoming) {
  cloud = cloud || {};
  incoming = incoming || {};
  var out = Object.assign({}, cloud, incoming);

  // transactions: per-tx LWW + union of tombstones
  var deletedSet = new Set((incoming.deletedTxIds || []).concat(cloud.deletedTxIds || []));
  out.deletedTxIds = Array.from(deletedSet);
  out.transactions = mergeTxArrays(incoming.transactions || [], cloud.transactions || [], deletedSet);
  out.transactionsUpdatedAt = Math.max(incoming.transactionsUpdatedAt || 0, cloud.transactionsUpdatedAt || 0) || null;

  // timestamped fields: keep whichever side has the higher <field>UpdatedAt (cloud wins ties)
  var FIELDS = [
    ['snapshots', 'snapshotsUpdatedAt'],
    ['manualWallets', 'manualWalletsUpdatedAt'],
    ['portfolio', 'portfolioUpdatedAt'],
    ['onchainWallets', 'onchainWalletsUpdatedAt'],
    ['presets', 'presetsUpdatedAt'],
    ['bdvLimits', 'bdvLimitsUpdatedAt'],
  ];
  FIELDS.forEach(function (pair) {
    var key = pair[0], ts = pair[1];
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
