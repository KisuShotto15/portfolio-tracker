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

  // Auth dual (como binance-balance): el dueno via X-Api-Secret (puede usar sus env
  // keys); cualquier usuario autorizado via JWT de Supabase → SOLO con las credenciales
  // que manda en el body, jamas las env keys del dueno.
  const apiSecret = process.env.API_SECRET;
  const isOwner = !!(apiSecret && req.headers['x-api-secret'] === apiSecret);
  const authed = isOwner || !!(await verifySupabaseUser(req));
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

  const { key: bKey, secret: bSecret, passphrase: bPass } = req.body || {};
  let key = bKey, secret = bSecret, passphrase = bPass;
  if ((!key || !secret || !passphrase) && isOwner) {
    key = key || process.env.OKX_KEY; secret = secret || process.env.OKX_SECRET; passphrase = passphrase || process.env.OKX_PASSPHRASE;
  }
  if (!key || !secret || !passphrase) return res.status(400).json({ error: 'key, secret and passphrase required' });

  const ts = new Date().toISOString();
  const method = 'GET';
  const path = '/api/v5/account/balance';
  const sign = crypto.createHmac('sha256', secret).update(ts + method + path).digest('base64');

  const r = await fetch(`https://www.okx.com${path}`, {
    headers: {
      'OK-ACCESS-KEY': key,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'x-simulated-trading': '0',
    },
  });
  const data = await r.json();
  if (!r.ok || data.code !== '0') return res.status(502).json({ error: data.msg || JSON.stringify(data) });
  res.json(data);
}
