import crypto from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiSecret = process.env.API_SECRET;
  if (!apiSecret || req.headers['x-api-secret'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = process.env.OKX_KEY;
  const secret = process.env.OKX_SECRET;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (!key || !secret || !passphrase) return res.status(500).json({ error: 'OKX_KEY / OKX_SECRET / OKX_PASSPHRASE not configured' });

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
