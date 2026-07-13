import crypto from 'node:crypto';
import { verifySupabaseUser, cors } from './_lib/web.js';

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: JWT de Supabase. Cada usuario consulta SOLO con las credenciales que manda
  // en el body (guardadas en SU fila, aisladas por RLS).
  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const { key, secret, passphrase } = req.body || {};
  if (!key || !secret || !passphrase) return res.status(400).json({ error: 'key, secret and passphrase required' });

  try {
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
  } catch (e) {
    return res.status(502).json({ error: 'OKX fetch failed: ' + String(e.message || e) });
  }
}
