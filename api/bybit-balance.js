import crypto from 'node:crypto';
import { verifySupabaseUser, cors } from './_lib/web.js';

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: JWT de Supabase. Cada usuario consulta SOLO con las key/secret que manda
  // en el body (guardadas en SU fila, aisladas por RLS).
  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const { key, secret } = req.body || {};
  if (!key || !secret) return res.status(400).json({ error: 'key and secret required' });

  try {
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
  } catch (e) {
    return res.status(502).json({ error: 'Bybit fetch failed: ' + String(e.message || e) });
  }
}
