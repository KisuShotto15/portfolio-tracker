import { verifySupabaseUser, cors } from './_lib/web.js';

const ANKR_URL = 'https://rpc.ankr.com/multichain/';
const MAX_WALLETS = 20;

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const ankrKey = process.env.ANKR_KEY;
  if (!ankrKey) return res.status(500).json({ error: 'ANKR_KEY not configured in Vercel env vars' });

  const { wallets } = req.body || {};
  if (!Array.isArray(wallets) || !wallets.length) return res.status(400).json({ error: 'wallets array required' });
  if (wallets.length > MAX_WALLETS) return res.status(400).json({ error: `max ${MAX_WALLETS} wallets per request` });

  try {
    const allHoldings = [];
    const btcWallets = wallets.filter(w => w.chain === 'btc');
    const evmWallets = wallets.filter(w => w.chain !== 'btc');

    // BTC via Trezor Blockbook (xpub/zpub/ypub) or Blockstream (single address)
    if (btcWallets.length) {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const priceJson = await priceRes.json();
      const btcPrice = priceJson?.bitcoin?.usd || 0;
      for (const w of btcWallets) {
        const isXpub = /^[xyz]pub/.test(w.address);
        let satoshis = 0;
        if (isXpub) {
          // Trezor Blockbook supports xpub/ypub/zpub natively
          const r = await fetch(`https://btc1.trezor.io/api/v2/xpub/${w.address}?details=basic`);
          const data = await r.json();
          if (data.error) throw new Error('Blockbook: ' + data.error);
          satoshis = parseInt(data.balance || '0') + parseInt(data.unconfirmedBalance || '0');
        } else {
          const r = await fetch(`https://blockstream.info/api/address/${w.address}`);
          const data = await r.json();
          if (data.chain_stats) satoshis = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
        }
        const balance = satoshis / 1e8;
        const balanceUsd = balance * btcPrice;
        if (balanceUsd > 0.01) allHoldings.push({
          walletId: w.id, walletLabel: w.label,
          symbol: 'BTC', name: 'Bitcoin',
          balance, balanceUsd, price: btcPrice, network: 'bitcoin',
        });
      }
    }

    // EVM via ANKR, en paralelo
    const evmResults = await Promise.all(evmWallets.map(async (w) => {
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
      return { w, json };
    }));

    for (const { w, json } of evmResults) {
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
  } catch (e) {
    return res.status(502).json({ error: 'balance fetch failed: ' + String(e.message || e) });
  }
}
