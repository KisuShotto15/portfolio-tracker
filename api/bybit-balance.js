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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: JWT de Supabase. Cada usuario consulta SOLO con las key/secret que manda
  // en el body (guardadas en SU fila, aisladas por RLS).
  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const { key, secret } = req.body || {};
  if (!key || !secret) return res.status(400).json({ error: 'key and secret required' });

  const ts = Date.now().toString();
  const recvWindow = '5000';
  const qs = 'accountType=UNIFIED';
  const paramStr = ts + key + recvWindow + qs;
  const sign = crypto.createHmac('sha256', secret).update(paramStr).digest('hex');

  const r = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${qs}`, {
    headers: {
      'X-BAPI-API-KEY': key,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': sign,
    },
  });
  const data = await r.json();
  if (!r.ok || data.retCode !== 0) return res.status(502).json({ error: data.retMsg || JSON.stringify(data) });
  res.json(data);
}
