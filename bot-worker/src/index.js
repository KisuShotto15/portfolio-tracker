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
      if (path === '/my-ads')    return await myAds(env);
      if (path === '/update-ad') return await updateAd(await request.json(), env);
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

// Para endpoints con JSON body:
// signature = HMAC("timestamp={ts}" + JSON_body_string)
// Query string: timestamp={ts}&signature={sig}
async function signedJsonRequest(bodyObj, secret) {
  const timestamp = Date.now();
  const bodyStr = JSON.stringify(bodyObj);
  const dataToSign = `timestamp=${timestamp}` + bodyStr;
  const signature = await sign(dataToSign, secret);
  return {
    qs: `timestamp=${timestamp}&signature=${signature}`,
    bodyStr,
  };
}

const SAPI_HEADERS = (apiKey) => ({
  'X-MBX-APIKEY': apiKey,
  'Content-Type': 'application/json',
  'clientType': 'web',
});

// ── Handlers ─────────────────────────────────────────

// Endpoint 4: GET ads list (PDF pág. 4)
// POST /sapi/v1/c2c/ads/listWithPagination
async function myAds(env) {
  const { qs, bodyStr } = await signedJsonRequest(
    { page: 1, rows: 20, tradeType: 'BUY', asset: 'USDT', fiatUnit: 'VES' },
    env.BINANCE_SECRET
  );
  const r = await fetch(`${BINANCE}/sapi/v1/c2c/ads/listWithPagination?${qs}`, {
    method: 'POST',
    headers: SAPI_HEADERS(env.BINANCE_KEY),
    body: bodyStr,
  });
  return json(await r.json());
}

// Endpoint 7: Update ad (PDF pág. 6)
// POST /sapi/v1/c2c/ads/update  — campo: advNo (no adNumber)
async function updateAd(params, env) {
  if (!params.advNo || params.price == null) return json({ error: 'advNo y price requeridos' }, 400);
  const { qs, bodyStr } = await signedJsonRequest(
    { advNo: String(params.advNo), price: Number(params.price) },
    env.BINANCE_SECRET
  );
  const r = await fetch(`${BINANCE}/sapi/v1/c2c/ads/update?${qs}`, {
    method: 'POST',
    headers: SAPI_HEADERS(env.BINANCE_KEY),
    body: bodyStr,
  });
  return json(await r.json());
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
