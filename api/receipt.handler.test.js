// Tests del endpoint que lee recibos. Dos cosas importan: que no se llame a la
// API sin necesidad (auth, tipo, tamano, configuracion), y que lo que devuelve el
// modelo se limpie antes de llegar al formulario — es texto leido de una foto,
// no un dato de la app.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

var createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', function () {
  return { default: class { constructor() { this.messages = { create: function () { return createMock.apply(null, arguments); } }; } } };
});

const { default: handler, cleanExtraction, cleanDate } = await import('../api/receipt.js');

function mkRes() {
  var res = { headers: {}, statusCode: null, body: null, ended: false };
  res.setHeader = function (k, v) { res.headers[k] = v; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.end = function () { res.ended = true; return res; };
  return res;
}
function mkReq(body, method) {
  return { method: method || 'POST', headers: { authorization: 'Bearer jwt' }, body: body };
}
const foto = { dataB64: 'AAAA', contentType: 'image/jpeg' };
function toolRes(input) {
  return Promise.resolve({ content: [{ type: 'tool_use', name: 'extract_receipt', input: input }] });
}

var realFetch = global.fetch;
beforeEach(function () {
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  createMock.mockReset();
  global.fetch = vi.fn(function (url) {
    if (String(url).indexOf('/auth/v1/user') >= 0) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: 'u1' }); } });
    throw new Error('llamada no mockeada: ' + url);
  });
});
afterEach(function () { global.fetch = realFetch; });

describe('api/receipt — guardas antes de gastar una llamada', function () {
  it('OPTIONS responde 204', async function () {
    var res = mkRes();
    await handler(mkReq(null, 'OPTIONS'), res);
    expect(res.statusCode).toBe(204);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('sin JWT valido no se lee nada', async function () {
    global.fetch = vi.fn(function () { return Promise.resolve({ ok: false }); });
    var res = mkRes();
    await handler(mkReq(foto), res);
    expect(res.statusCode).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  // Sin clave no esta roto: es que esta funcion es opcional. El cliente distingue
  // el 503 y ni menciona la lectura.
  it('sin clave configurada responde 503, no 500', async function () {
    delete process.env.ANTHROPIC_API_KEY;
    var res = mkRes();
    await handler(mkReq(foto), res);
    expect(res.statusCode).toBe(503);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('solo imagenes, y con techo de tamano', async function () {
    var res1 = mkRes();
    await handler(mkReq({ dataB64: 'AAAA', contentType: 'application/pdf' }), res1);
    expect(res1.statusCode).toBe(400);
    var res2 = mkRes();
    await handler(mkReq({ dataB64: Buffer.alloc(4_000_001).toString('base64'), contentType: 'image/jpeg' }), res2);
    expect(res2.statusCode).toBe(413);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('api/receipt — la llamada', function () {
  it('manda la imagen y exige la herramienta', async function () {
    createMock.mockReturnValue(toolRes({ found: true, amount: 12.5, currency: 'USD', date: '', merchant: 'Farmatodo' }));
    var res = mkRes();
    await handler(mkReq(foto), res);
    var args = createMock.mock.calls[0][0];
    expect(args.messages[0].content[0].source.data).toBe('AAAA');
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'extract_receipt' });
    expect(args.tools[0].strict).toBe(true);
    expect(res.body.amount).toBe(12.5);
  });

  it('si el modelo no llama la herramienta, no se inventa nada', async function () {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'no se ve nada' }] });
    var res = mkRes();
    await handler(mkReq(foto), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it('un fallo de la API se explica, no se traga', async function () {
    createMock.mockRejectedValue(new Error('credit balance is too low'));
    var res = mkRes();
    await handler(mkReq(foto), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('credit balance');
  });
});

describe('limpieza de lo que devuelve el modelo', function () {
  const hoy = Date.parse('2026-09-13T12:00:00Z');

  it('monto: solo positivos, redondeado a centavos', function () {
    expect(cleanExtraction({ found: true, amount: 12.345 }, hoy).amount).toBe(12.35);
    expect(cleanExtraction({ found: true, amount: -5 }, hoy).amount).toBe(0);
    expect(cleanExtraction({ found: true, amount: 'doce' }, hoy).amount).toBe(0);
  });

  it('moneda: solo USD o VES, lo demas se descarta', function () {
    expect(cleanExtraction({ currency: 'VES' }, hoy).currency).toBe('VES');
    expect(cleanExtraction({ currency: 'OTHER' }, hoy).currency).toBe('');
    expect(cleanExtraction({ currency: 'EUR' }, hoy).currency).toBe('');
  });

  // Un anio mal leido manda el gasto a otro mes sin que se note hasta el cierre.
  it('fecha: formato exacto y plausible', function () {
    expect(cleanDate('2026-09-10', hoy)).toBe('2026-09-10');
    expect(cleanDate('10/09/2026', hoy)).toBe('');
    expect(cleanDate('2031-01-01', hoy)).toBe('');   // del futuro
    expect(cleanDate('2019-05-05', hoy)).toBe('');   // demasiado vieja
    expect(cleanDate('', hoy)).toBe('');
  });

  it('comercio: una linea, recortado', function () {
    expect(cleanExtraction({ merchant: '  Farma  todo \n ' }, hoy).merchant).toBe('Farma todo');
    expect(cleanExtraction({ merchant: 'x'.repeat(200) }, hoy).merchant.length).toBe(60);
  });

  it('found solo es true si el modelo lo dijo', function () {
    expect(cleanExtraction({ found: 'si' }, hoy).found).toBe(false);
    expect(cleanExtraction({ found: true }, hoy).found).toBe(true);
  });
});
