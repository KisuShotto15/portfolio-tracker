// Proxy unico de saldos: Binance, Bybit, OKX y ANKR (holdings on-chain), elegidos
// con ?ex=. Eran cuatro archivos casi identicos, y Vercel cuenta CADA archivo de
// api/ como una serverless function: el plan Hobby permite 12 y estaban 10 usadas.
// Unificarlos libera tres slots sin cambiar una sola respuesta.
//
// Los cuatro comparten exactamente lo mismo: CORS, solo POST, y el JWT de Supabase
// del usuario. Lo unico propio de cada uno es como firma y que devuelve — eso vive
// en su funcion de abajo, con el mismo codigo, los mismos status y el mismo shape
// de respuesta que tenian por separado (el cliente no distingue).
//
// Por que existen estos proxies: ninguna de esas APIs manda CORS abierto, asi que
// el navegador no las puede pedir directo. Las credenciales NO se guardan aca: cada
// request las trae en el body desde el localStorage del dispositivo (ft13_xk).
import crypto from 'node:crypto';
import { verifySupabaseUser, cors } from './_lib/web.js';

const ANKR_URL = 'https://rpc.ankr.com/multichain/';
const MAX_WALLETS = 20;

async function binance(req, res) {
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

    return res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    return res.status(502).json({ error: 'Binance fetch failed: ' + String(e.message || e) });
  }
}

async function bybit(req, res) {
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
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Bybit fetch failed: ' + String(e.message || e) });
  }
}

async function okx(req, res) {
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
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ error: 'OKX fetch failed: ' + String(e.message || e) });
  }
}

async function ankr(req, res) {
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
    return res.json(allHoldings);
  } catch (e) {
    return res.status(502).json({ error: 'balance fetch failed: ' + String(e.message || e) });
  }
}

export const PROVIDERS = { binance, bybit, okx, ankr };

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: JWT de Supabase. Cada usuario consulta SOLO con las credenciales que
  // manda en el body; el server no guarda ninguna.
  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const ex = (req.query && req.query.ex) || '';
  const fn = Object.prototype.hasOwnProperty.call(PROVIDERS, ex) ? PROVIDERS[ex] : null;
  // Sin devolver el valor recibido: no tiene sentido hacerle eco a un parametro
  // que vino de afuera.
  if (!fn) return res.status(400).json({ error: 'unknown ?ex= (binance, bybit, okx, ankr)' });

  return fn(req, res);
}
