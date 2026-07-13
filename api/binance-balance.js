import crypto from 'node:crypto';
import { verifySupabaseUser, cors } from './_lib/web.js';

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: JWT de Supabase. Cada usuario consulta SOLO con las key/secret que manda
  // en el body (guardadas en SU fila, aisladas por RLS).
  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const { key: k, secret: s } = req.body || {};
  if (!k || !s) return res.status(400).json({ error: 'key and secret required' });

  try {
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
  } catch (e) {
    return res.status(502).json({ error: 'Binance fetch failed: ' + String(e.message || e) });
  }
}
