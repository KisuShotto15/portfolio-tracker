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
      if (path === '/ping')       return await ping(env);
      if (path === '/my-ads')    return await myAds(env);
      if (path === '/update-ad') return await updateAd(await request.json(), env);
      if (path === '/toggle-ad') return await toggleAd(await request.json(), env);
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

// C2C SAPI signing: only query string params are signed (not the JSON body).
// Per PDF example: sign("param1={v}&param2={v}&timestamp={ts}")
// For JSON body endpoints: only timestamp is in query string → sign("timestamp={ts}")
async function signedJsonRequest(bodyObj, secret) {
  const timestamp = Date.now();
  const bodyStr = JSON.stringify(bodyObj);
  const dataToSign = `timestamp=${timestamp}`;
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

// Diagnostic: verify secrets are loaded and signing works
async function ping(env) {
  const keyLen    = env.BINANCE_KEY    ? env.BINANCE_KEY.length    : 0;
  const secretLen = env.BINANCE_SECRET ? env.BINANCE_SECRET.length : 0;
  const testSig   = secretLen > 0 ? await sign('ping', env.BINANCE_SECRET) : 'NO_SECRET';
  const workerTs  = Date.now();
  // Fetch Binance server time to check clock drift
  let binanceTs = null, drift = null;
  try {
    const r = await fetch('https://api.binance.com/api/v3/time');
    const d = await r.json();
    binanceTs = d.serverTime;
    drift = workerTs - binanceTs;
  } catch(e) { binanceTs = 'error'; }
  return json({ ok: true, keyLen, secretLen, testSig, workerTs, binanceTs, driftMs: drift });
}

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

// Endpoint: enable/disable ad
// POST /sapi/v1/c2c/ads/updateStatus  advStatus: 1=online 0=offline
async function toggleAd(params, env) {
  if (!params.advNo || params.advStatus == null) return json({ error: 'advNo y advStatus requeridos' }, 400);
  // updateStatus uses advNos (array), not advNo (singular) — PDF page 7-8
  const { qs, bodyStr } = await signedJsonRequest(
    { advNos: [String(params.advNo)], advStatus: Number(params.advStatus) },
    env.BINANCE_SECRET
  );
  const r = await fetch(`${BINANCE}/sapi/v1/c2c/ads/updateStatus?${qs}`, {
    method: 'POST',
    headers: SAPI_HEADERS(env.BINANCE_KEY),
    body: bodyStr,
  });
  return json(await r.json());
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
