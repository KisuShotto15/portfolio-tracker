const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const path = new URL(request.url).pathname;

    try {
      if (path === '/debug-ip')                return await debugIP();
      if (path === '/' || path === '/binance') return await binanceBalance(env);
      if (path === '/bybit')                   return await bybitBalance(env);
      if (path === '/okx')                     return await okxBalance(env);
    } catch (e) {
      return json({ error: e.message }, 500);
    }

    return json({ error: 'Unknown route' }, 404);
  }
};

// ── Debug ─────────────────────────────────────────────

async function debugIP() {
  const [ipRes, apiTest, p2pTest] = await Promise.all([
    fetch('https://api.ipify.org?format=json').then(r => r.json()).catch(() => ({})),
    fetch('https://api.binance.com/api/v3/time').then(async r => ({ status: r.status, body: (await r.text()).slice(0, 80) })).catch(e => ({ error: e.message })),
    fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'USDT', fiat: 'VES', merchantCheck: false, page: 1, rows: 1, tradeType: 'SELL', transAmount: 100 })
    }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 80) })).catch(e => ({ error: e.message })),
  ]);
  const ip = ipRes.ip || 'n/a';
  const geo = await fetch(`http://ip-api.com/json/${ip}`).then(r => r.json()).catch(() => ({}));
  return json({ ip, country: geo.country, isp: geo.isp, api_binance: apiTest, p2p_binance: p2pTest });
}

// ── Helpers ───────────────────────────────────────────

async function hmac256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ── Binance Spot wallet ───────────────────────────────
// GET /api/v3/account  (returns {balances:[{asset,free,locked}]})
async function binanceBalance(env) {
  const ts = Date.now();
  const qs = `timestamp=${ts}`;
  const sig = await hmac256(env.BINANCE_SECRET, qs);
  const r = await fetch(
    `https://api.binance.com/api/v3/account?${qs}&signature=${sig}`,
    { headers: { 'X-MBX-APIKEY': env.BINANCE_KEY } }
  );
  const data = await r.json();
  if (!r.ok || data.code) return json({ error: data.msg || JSON.stringify(data) }, 502);
  // Return balances array so app can find USDT with Array.isArray check
  return json(data.balances || []);
}

// ── Bybit Unified account ─────────────────────────────
async function bybitBalance(env) {
  const ts = String(Date.now());
  const recv = '5000';
  const params = 'accountType=UNIFIED&coin=USDT';
  const toSign = ts + env.BYBIT_KEY + recv + params;
  const sig = await hmac256(env.BYBIT_SECRET, toSign);
  const r = await fetch(
    `https://api.bybit.com/v5/account/wallet-balance?${params}`,
    { headers: { 'X-BAPI-API-KEY': env.BYBIT_KEY, 'X-BAPI-SIGN': sig, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recv } }
  );
  const data = await r.json();
  if (data.retCode !== 0) return json({ error: data.retMsg }, 502);
  return json(data);
}

// ── OKX Trading account ───────────────────────────────
async function okxBalance(env) {
  const ts = new Date().toISOString();
  const path = '/api/v5/account/balance?ccy=USDT';
  const toSign = ts + 'GET' + path;
  const sig = btoa(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.sign('HMAC',
      await crypto.subtle.importKey('raw', new TextEncoder().encode(env.OKX_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
      new TextEncoder().encode(toSign)
    )
  )));
  const r = await fetch(
    `https://www.okx.com${path}`,
    { headers: { 'OK-ACCESS-KEY': env.OKX_KEY, 'OK-ACCESS-SIGN': sig, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': env.OKX_PASSPHRASE } }
  );
  const data = await r.json();
  if (data.code !== '0') return json({ error: data.msg }, 502);
  return json(data.data?.[0] || {});
}
