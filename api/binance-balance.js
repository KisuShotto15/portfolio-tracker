import crypto from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key, secret } = req.body || {};
  if (!key || !secret) return res.status(400).json({ error: 'key and secret required' });

  const ts = Date.now();
  const qs = `asset=USDT&timestamp=${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');

  const r = await fetch(`https://api.binance.com/sapi/v1/asset/get-funding-asset?${qs}&signature=${sig}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': key },
  });
  const data = await r.json();
  if (!r.ok || data.code) return res.status(502).json({ error: data.msg || JSON.stringify(data) });

  res.json(Array.isArray(data) ? data : []);
}
