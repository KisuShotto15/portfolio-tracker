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
  } else if (req.method === 'POST') {
    const r = await fetch(dataUrl + '/data', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const body = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').end(body);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
