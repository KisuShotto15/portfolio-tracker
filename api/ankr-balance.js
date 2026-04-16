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
  const btcWallets = wallets.filter(w => w.chain === 'btc');
  const evmWallets = wallets.filter(w => w.chain !== 'btc');

  // BTC via Blockstream (no API key needed)
  if (btcWallets.length) {
    const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const priceJson = await priceRes.json();
    const btcPrice = priceJson?.bitcoin?.usd || 0;
    for (const w of btcWallets) {
      const r = await fetch(`https://blockstream.info/api/address/${w.address}`);
      const data = await r.json();
      if (data.chain_stats) {
        const satoshis = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
        const balance = satoshis / 1e8;
        const balanceUsd = balance * btcPrice;
        if (balanceUsd > 0.01) allHoldings.push({
          walletId: w.id, walletLabel: w.label,
          symbol: 'BTC', name: 'Bitcoin',
          balance, balanceUsd, price: btcPrice, network: 'bitcoin',
        });
      }
    }
  }

  // EVM via ANKR
  for (const w of evmWallets) {
    const r = await fetch(ANKR_URL + ankrKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'ankr_getAccountBalance',
        params: { blockchain: ['eth', 'arbitrum', 'base', 'bsc'], walletAddress: w.address, onlyWhitelisted: true },
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
