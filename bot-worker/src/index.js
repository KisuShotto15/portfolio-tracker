const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Token',
};

const BINANCE = 'https://api.binance.com';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.headers.get('X-Bot-Token') !== env.BOT_TOKEN) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const path = new URL(request.url).pathname;

    try {
      if (path === '/my-ads')     return await myAds(env);
      if (path === '/update-ad')  return await updateAd(await request.json(), env);
    } catch (e) {
      return json({ error: e.message }, 500);
    }

    return json({ error: 'Not found' }, 404);
  }
};

// ── HMAC-SHA256 ──────────────────────────────────────
async function sign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedBody(params, secret) {
  const base = Object.entries({ ...params, timestamp: Date.now() })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return base + '&signature=' + await sign(base, secret);
}

// ── Handlers ─────────────────────────────────────────
async function myAds(env) {
  const body = await signedBody({ page: 1, rows: 20, tradeType: 'BUY', asset: 'USDT', fiat: 'VES' }, env.BINANCE_SECRET);
  const r = await fetch(`${BINANCE}/sapi/v1/c2c/ads/getAdList`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': env.BINANCE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  return json(await r.json());
}

async function updateAd(params, env) {
  if (!params.adNumber || params.price == null) return json({ error: 'adNumber y price requeridos' }, 400);
  const body = await signedBody({ adNumber: String(params.adNumber), price: String(params.price) }, env.BINANCE_SECRET);
  const r = await fetch(`${BINANCE}/sapi/v1/c2c/ads/updateAd`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': env.BINANCE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  return json(await r.json());
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
