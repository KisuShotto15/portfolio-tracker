import crypto from 'node:crypto';

// Verifica el JWT de Supabase (mismo patron que sync.js). Devuelve el user o null.
async function verifySupabaseUser(req) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) return null;
  const jwt = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + jwt } });
  if (!r.ok) return null;
  return await r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth dual: el dueno via X-Api-Secret; cualquier usuario autorizado via JWT
  // de Supabase. El dueno puede usar sus env keys; el usuario JWT SOLO sus propias
  // key/secret del body — nunca puede tocar las env keys del dueno.
  const apiSecret = process.env.API_SECRET;
  const isOwner = !!(apiSecret && req.headers['x-api-secret'] === apiSecret);
  const authed = isOwner || !!(await verifySupabaseUser(req));
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

  const { key, secret, account } = req.body || {};
  let k = key, s = secret;
  // env-fallback (claves del dueno) SOLO por el path X-Api-Secret.
  if ((!k || !s) && isOwner) {
    k = k || (account === 'bibi' ? process.env.BIBI_BINANCE_KEY : process.env.BINANCE_KEY);
    s = s || (account === 'bibi' ? process.env.BIBI_BINANCE_SECRET : process.env.BINANCE_SECRET);
  }
  if (!k || !s) return res.status(400).json({ error: 'key and secret required' });

  const ts = Date.now();
  const qs = `asset=USDT&timestamp=${ts}`;
  const sig = crypto.createHmac('sha256', s).update(qs).digest('hex');

  const r = await fetch(`https://api.binance.com/sapi/v1/asset/get-funding-asset?${qs}&signature=${sig}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': k },
  });
  const data = await r.json();
  if (!r.ok || data.code) return res.status(502).json({ error: data.msg || JSON.stringify(data) });

  res.json(Array.isArray(data) ? data : []);
}
