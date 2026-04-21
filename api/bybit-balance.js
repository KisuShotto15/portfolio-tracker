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

  const key = process.env.BYBIT_KEY;
  const secret = process.env.BYBIT_SECRET;
  if (!key || !secret) return res.status(500).json({ error: 'BYBIT_KEY / BYBIT_SECRET not configured' });

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
