// Tests del endpoint de recibos. Lo que se fija aca es lo que hacia falta para
// cerrar F16: que lo que se sube sea PRIVADO, que viva bajo el prefijo de su
// usuario, y que la unica forma de leerlo sea una URL firmada que este endpoint
// emite despues de comprobar que el pathname es tuyo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

var putMock = vi.fn();
var issueMock = vi.fn();
var presignMock = vi.fn();
vi.mock('@vercel/blob', function () {
  return {
    put: function () { return putMock.apply(null, arguments); },
    issueSignedToken: function () { return issueMock.apply(null, arguments); },
    presignUrl: function () { return presignMock.apply(null, arguments); },
  };
});

const { default: handler, ownsPath, receiptPath, receiptPrefix } = await import('../api/blob-upload.js');

function mkRes() {
  var res = { headers: {}, statusCode: null, body: null, ended: false };
  res.setHeader = function (k, v) { res.headers[k] = v; };
  res.status = function (c) { res.statusCode = c; return res; };
  res.json = function (b) { res.body = b; return res; };
  res.end = function () { res.ended = true; return res; };
  return res;
}
function mkReq(method, opts) {
  opts = opts || {};
  return {
    method: method,
    headers: { authorization: opts.noAuth ? '' : 'Bearer jwt' },
    query: opts.query || {},
    body: opts.body,
  };
}

var realFetch = global.fetch;
beforeEach(function () {
  process.env.SUPABASE_URL = 'https://sb.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
  putMock.mockReset(); issueMock.mockReset(); presignMock.mockReset();
  putMock.mockResolvedValue({ pathname: 'receipts/u1/123-receipt.jpg', url: 'https://store/x' });
  issueMock.mockResolvedValue({ delegationToken: 'DELEGATION-SECRET', clientSigningToken: 'SIGNING-SECRET', validUntil: 9999 });
  presignMock.mockImplementation(function (tok, o) { return Promise.resolve({ presignedUrl: 'https://store/' + o.pathname + '?sig=abc' }); });
  global.fetch = vi.fn(function (url) {
    if (String(url).indexOf('/auth/v1/user') >= 0) {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ id: 'u1' }); } });
    }
    throw new Error('llamada no mockeada: ' + url);
  });
});
afterEach(function () { global.fetch = realFetch; });

describe('api/blob-upload — guardas', function () {
  it('OPTIONS responde 204 y anuncia GET (la firma se pide por GET)', async function () {
    var res = mkRes();
    await handler(mkReq('OPTIONS'), res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://portfolio.kisushotto.com');
  });

  it('sin JWT valido no se sube ni se firma nada', async function () {
    global.fetch = vi.fn(function () { return Promise.resolve({ ok: false }); });
    var res = mkRes();
    await handler(mkReq('POST', { body: { filename: 'r.jpg', dataB64: 'AAA=', contentType: 'image/jpeg' } }), res);
    expect(res.statusCode).toBe(401);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('un metodo que no es GET/POST no se atiende', async function () {
    var res = mkRes();
    await handler(mkReq('DELETE'), res);
    expect(res.statusCode).toBe(405);
  });
});

describe('api/blob-upload — subida', function () {
  it('sube PRIVADO y bajo el prefijo del usuario', async function () {
    var res = mkRes();
    await handler(mkReq('POST', { body: { filename: 'r.jpg', dataB64: 'AAAA', contentType: 'image/jpeg' } }), res);
    expect(res.statusCode).toBe(200);
    var args = putMock.mock.calls[0];
    expect(args[0].indexOf('receipts/u1/')).toBe(0);
    expect(args[2].access).toBe('private');
    expect(args[2].contentType).toBe('image/jpeg');
  });

  // La URL de un blob privado no sirve sin firma; devolverla invita a guardarla
  // como si fuera un enlace permanente, que es justo lo que se vino a quitar.
  it('devuelve el pathname, no una URL', async function () {
    var res = mkRes();
    await handler(mkReq('POST', { body: { filename: 'r.jpg', dataB64: 'AAAA', contentType: 'image/jpeg' } }), res);
    expect(res.body.pathname).toBe('receipts/u1/123-receipt.jpg');
    expect(res.body.url).toBeUndefined();
  });

  it('solo imagenes de los tres tipos permitidos', async function () {
    var res = mkRes();
    await handler(mkReq('POST', { body: { filename: 'r.pdf', dataB64: 'AAAA', contentType: 'application/pdf' } }), res);
    expect(res.statusCode).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('4 MB es el techo', async function () {
    var res = mkRes();
    var big = Buffer.alloc(4_000_001).toString('base64');
    await handler(mkReq('POST', { body: { filename: 'r.jpg', dataB64: big, contentType: 'image/jpeg' } }), res);
    expect(res.statusCode).toBe(413);
  });

  // Si el plan no permite blobs privados, el fallo tiene que ser legible desde el
  // aviso del cliente: es la unica forma de enterarse sin entrar a Vercel.
  it('un fallo de subida dice por que', async function () {
    putMock.mockRejectedValue(new Error('private access not enabled for this store'));
    var res = mkRes();
    await handler(mkReq('POST', { body: { filename: 'r.jpg', dataB64: 'AAAA', contentType: 'image/jpeg' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain('private access not enabled');
  });
});

describe('api/blob-upload — firma de lectura', function () {
  it('firma los pathnames propios, uno por uno', async function () {
    var res = mkRes();
    await handler(mkReq('GET', { query: { paths: 'receipts/u1/a.jpg,receipts/u1/b.jpg' } }), res);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.urls)).toEqual(['receipts/u1/a.jpg', 'receipts/u1/b.jpg']);
    expect(presignMock.mock.calls[0][1].access).toBe('private');
    expect(presignMock.mock.calls[0][1].operation).toBe('get');
  });

  // Una sola delegacion por tanda: la lista puede pedir decenas de miniaturas y
  // cada delegacion es una llamada al control plane de Blob.
  it('pide UNA delegacion para toda la tanda', async function () {
    var res = mkRes();
    await handler(mkReq('GET', { query: { paths: 'receipts/u1/a.jpg,receipts/u1/b.jpg,receipts/u1/c.jpg' } }), res);
    expect(issueMock).toHaveBeenCalledTimes(1);
    expect(presignMock).toHaveBeenCalledTimes(3);
  });

  // El token de delegacion abre TODO el store: si se filtra al cliente, el
  // endpoint no sirvio de nada.
  it('el token de delegacion no sale en la respuesta', async function () {
    var res = mkRes();
    await handler(mkReq('GET', { query: { paths: 'receipts/u1/a.jpg' } }), res);
    expect(JSON.stringify(res.body)).not.toContain('DELEGATION-SECRET');
    expect(JSON.stringify(res.body)).not.toContain('SIGNING-SECRET');
  });

  it('el recibo de otro usuario no se firma', async function () {
    var res = mkRes();
    await handler(mkReq('GET', { query: { paths: 'receipts/u2/secreto.jpg' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.urls).toEqual({});
    expect(presignMock).not.toHaveBeenCalled();
  });

  it('en una tanda mixta solo pasa lo propio', async function () {
    var res = mkRes();
    await handler(mkReq('GET', { query: { paths: 'receipts/u1/mio.jpg,receipts/u2/ajeno.jpg' } }), res);
    expect(Object.keys(res.body.urls)).toEqual(['receipts/u1/mio.jpg']);
  });

  it('sin paths no hay nada que firmar', async function () {
    var res = mkRes();
    await handler(mkReq('GET', { query: {} }), res);
    expect(res.statusCode).toBe(400);
  });

  it('una tanda desmedida se rechaza', async function () {
    var res = mkRes();
    var muchos = Array.from({ length: 81 }, function (_, i) { return 'receipts/u1/' + i + '.jpg'; }).join(',');
    await handler(mkReq('GET', { query: { paths: muchos } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('pathname de un recibo', function () {
  it('la pertenencia es el prefijo del usuario', function () {
    expect(ownsPath('receipts/u1/a.jpg', 'u1')).toBe(true);
    expect(ownsPath('receipts/u2/a.jpg', 'u1')).toBe(false);
    // El recibo viejo (sin usuario en el pathname) tampoco pasa: esos se leen por
    // su URL publica hasta que la migracion los vuelve a subir.
    expect(ownsPath('receipts/1757-receipt.jpg', 'u1')).toBe(false);
  });

  it('un salto de directorio no cuela', function () {
    expect(ownsPath('receipts/u1/../u2/a.jpg', 'u1')).toBe(false);
  });

  it('el nombre del archivo se sanea', function () {
    var p = receiptPath('u1', '../../etc/passwd');
    expect(p.indexOf(receiptPrefix('u1'))).toBe(0);
    expect(p).not.toContain('..');
    expect(p).not.toContain('/etc/');
  });
});
