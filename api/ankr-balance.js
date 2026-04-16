const ANKR_URL = 'https://rpc.ankr.com/multichain/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiSecret = process.env.API_SECRET;
  if (apiSecret && req.headers['x-api-secret'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ankrKey = process.env.ANKR_KEY;
  if (!ankrKey) return res.status(500).json({ error: 'ANKR_KEY not configured in Vercel env vars' });

  const { wallets } = req.body || {};
  if (!Array.isArray(wallets) || !wallets.length) return res.status(400).json({ error: 'wallets array required' });

  const allHoldings = [];
  for (const w of wallets) {
    const blockchains = w.chain === 'btc' ? ['bitcoin'] : ['eth', 'arbitrum', 'base', 'bsc'];
    const r = await fetch(ANKR_URL + ankrKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'ankr_getAccountBalance',
        params: { blockchain: blockchains, walletAddress: w.address, onlyWhitelisted: true },
        id: 1
      }),
    });
    const json = await r.json();
    if (json.error) return res.status(502).json({ error: typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error)) });
    const assets = (json.result && json.result.assets) || [];
    for (const a of assets) {
      if (parseFloat(a.balanceUsd) > 1) {
        allHoldings.push({
          walletId: w.id, walletLabel: w.label,
          symbol: a.tokenSymbol, name: a.tokenName,
          balance: parseFloat(a.balance), balanceUsd: parseFloat(a.balanceUsd),
          price: parseFloat(a.tokenPrice), network: a.blockchain,
        });
      }
    }
  }

  allHoldings.sort((a, b) => b.balanceUsd - a.balanceUsd);
  res.json(allHoldings);
}
