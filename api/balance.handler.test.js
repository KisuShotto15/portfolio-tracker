// Tests del proxy unico de saldos (api/balance.js). Los cuatro endpoints que se
// fusionaron compartian CORS, metodo y auth; lo que cambia por exchange es como
// firma y que devuelve. Estos tests fijan el despacho y que cada proveedor siga
// dando el MISMO status y el mismo shape que daba cuando era su propio archivo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/balance.js';

function mkRes() {
  var res = { headers: {}, statusCode: null, body: null, ended: false };
  res.setHeader = function (k, v) { res.headers[k] = v; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.end = function () { res.ended = true; return res; };
  return res;
}
function mkReq(ex, body, method) {
  return { method: method || 'POST', headers: { authorization: 'Bearer jwt' }, query: { ex: ex }, body: body };
}
function jsonRes(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
}

var realFetch = global.fetch;
beforeEach(function () {
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  // Por defecto: el JWT es valido y cualquier otra llamada falla si no se mockea.
  global.fetch = vi.fn(function (url) {
    if (String(url).indexOf('/auth/v1/user') >= 0) return jsonRes(200, { id: 'u1' });
    throw new Error('llamada no mockeada: ' + url);
  });
});
afterEach(function () { global.fetch = realFetch; });

describe('api/balance — despacho y guardas comunes', function () {
  it('OPTIONS responde 204 con los headers de CORS', async function () {
    var res = mkRes();
    await handler(mkReq('binance', {}, 'OPTIONS'), res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://portfolio.kisushotto.com');
  });

  it('GET no se acepta', async function () {
    var res = mkRes();
    await handler(mkReq('binance', null, 'GET'), res);
    expect(res.statusCode).toBe(405);
  });

  it('sin JWT valido de Supabase: 401 y NO se llama al exchange', async function () {
    var llamadas = [];
    global.fetch = vi.fn(function (url) { llamadas.push(String(url)); return jsonRes(401, {}); });
    var res = mkRes();
    await handler(mkReq('binance', { key: 'k', secret: 's' }), res);
    expect(res.statusCode).toBe(401);
    expect(llamadas.every(function (u) { return u.indexOf('binance.com') < 0; })).toBe(true);
  });

  it('?ex= desconocido: 400 sin hacerle eco al valor recibido', async function () {
    var res = mkRes();
    await handler(mkReq('<script>', {}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown ?ex= (binance, bybit, okx, ankr)');
  });

  it('?ex= vacio tambien es 400', async function () {
    var res = mkRes();
    await handler(mkReq('', {}), res);
    expect(res.statusCode).toBe(400);
  });

  it('un ?ex= que existe en Object.prototype no despacha nada', async function () {
    // PROVIDERS es un objeto plano: sin hasOwnProperty, ?ex=constructor entraba.
    var res = mkRes();
    await handler(mkReq('constructor', {}), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('api/balance — cada proveedor conserva su contrato', function () {
  it('binance: sin credenciales 400; con ellas firma y devuelve el array', async function () {
    var res = mkRes();
    await handler(mkReq('binance', {}), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('key and secret required');

    var pedido = null;
    global.fetch = vi.fn(function (url, opts) {
      if (String(url).indexOf('/auth/v1/user') >= 0) return jsonRes(200, { id: 'u1' });
      pedido = { url: String(url), opts: opts };
      return jsonRes(200, [{ asset: 'USDT', free: '10' }]);
    });
    var res2 = mkRes();
    await handler(mkReq('binance', { key: 'k', secret: 's' }), res2);
    expect(res2.body).toEqual([{ asset: 'USDT', free: '10' }]);
    expect(pedido.url).toContain('api.binance.com/sapi/v1/asset/get-funding-asset');
    expect(pedido.url).toContain('signature=');
    expect(pedido.opts.headers['X-MBX-APIKEY']).toBe('k');
  });

  it('binance: un error de la API sale como 502', async function () {
    global.fetch = vi.fn(function (url) {
      if (String(url).indexOf('/auth/v1/user') >= 0) return jsonRes(200, { id: 'u1' });
      return jsonRes(200, { code: -2015, msg: 'Invalid API-key' });
    });
    var res = mkRes();
    await handler(mkReq('binance', { key: 'k', secret: 's' }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('Invalid API-key');
  });

  it('bybit: firma con los headers V5 y propaga retCode != 0 como 502', async function () {
    var headers = null;
    global.fetch = vi.fn(function (url, opts) {
      if (String(url).indexOf('/auth/v1/user') >= 0) return jsonRes(200, { id: 'u1' });
      headers = opts.headers;
      return jsonRes(200, { retCode: 10003, retMsg: 'API key invalid' });
    });
    var res = mkRes();
    await handler(mkReq('bybit', { key: 'k', secret: 's' }), res);
    expect(headers['X-BAPI-API-KEY']).toBe('k');
    expect(headers['X-BAPI-SIGN']).toBeTruthy();
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('API key invalid');
  });

  it('okx: exige passphrase', async function () {
    var res = mkRes();
    await handler(mkReq('okx', { key: 'k', secret: 's' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('key, secret and passphrase required');
  });

  it('okx: firma en base64 y devuelve el cuerpo tal cual con code 0', async function () {
    var headers = null;
    global.fetch = vi.fn(function (url, opts) {
      if (String(url).indexOf('/auth/v1/user') >= 0) return jsonRes(200, { id: 'u1' });
      headers = opts.headers;
      return jsonRes(200, { code: '0', data: [{ details: [{ ccy: 'USDT', cashBal: '25' }] }] });
    });
    var res = mkRes();
    await handler(mkReq('okx', { key: 'k', secret: 's', passphrase: 'p' }), res);
    expect(headers['OK-ACCESS-PASSPHRASE']).toBe('p');
    expect(headers['OK-ACCESS-SIGN']).toMatch(/=$|^[A-Za-z0-9+/]+=*$/);
    expect(res.body.data[0].details[0].cashBal).toBe('25');
  });

  it('ankr: sin ANKR_KEY es 500, y con wallets vacias 400', async function () {
    var prev = process.env.ANKR_KEY;
    delete process.env.ANKR_KEY;
    var res = mkRes();
    await handler(mkReq('ankr', { wallets: [{ id: 1, address: '0x1' }] }), res);
    expect(res.statusCode).toBe(500);

    process.env.ANKR_KEY = 'ankr-test';
    var res2 = mkRes();
    await handler(mkReq('ankr', { wallets: [] }), res2);
    expect(res2.statusCode).toBe(400);
    if (prev === undefined) delete process.env.ANKR_KEY; else process.env.ANKR_KEY = prev;
  });

  it('ankr: corta arriba de 20 wallets por request', async function () {
    process.env.ANKR_KEY = 'ankr-test';
    var muchas = [];
    for (var i = 0; i < 21; i++) muchas.push({ id: i, address: '0x' + i, label: 'w' + i });
    var res = mkRes();
    await handler(mkReq('ankr', { wallets: muchas }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('max 20');
    delete process.env.ANKR_KEY;
  });

  it('ankr: arma los holdings EVM y descarta los de menos de $1', async function () {
    process.env.ANKR_KEY = 'ankr-test';
    global.fetch = vi.fn(function (url) {
      if (String(url).indexOf('/auth/v1/user') >= 0) return jsonRes(200, { id: 'u1' });
      return jsonRes(200, { result: { assets: [
        { tokenSymbol: 'ETH', tokenName: 'Ethereum', balance: '0.3', balanceUsd: '900', tokenPrice: '3000', blockchain: 'eth' },
        { tokenSymbol: 'SHIB', tokenName: 'Shiba', balance: '10', balanceUsd: '0.4', tokenPrice: '0.04', blockchain: 'eth' },
      ] } });
    });
    var res = mkRes();
    await handler(mkReq('ankr', { wallets: [{ id: 7, address: '0xabc', label: 'Trezor' }] }), res);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ walletId: 7, walletLabel: 'Trezor', symbol: 'ETH', balanceUsd: 900, network: 'eth' });
    delete process.env.ANKR_KEY;
  });
});
