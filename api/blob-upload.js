// Recibos: subida privada y URLs firmadas para leerlos.
//
// Antes cada recibo se subia con access:'public'. La URL es larga y aleatoria,
// pero es PERMANENTE y publica: cualquiera que la tenga (y viaja en el doc que
// se sincroniza, y se renderiza como <img src> en la lista) ve la imagen para
// siempre, sin sesion y sin caducar. En una foto de una confirmacion de pago eso
// es el numero de cuenta y la referencia.
//
// Ahora el blob es privado y solo se puede leer con una URL firmada que dura una
// hora y que este endpoint emite despues de verificar el JWT del usuario. Ademas
// cada recibo vive bajo el prefijo de SU usuario, asi que la comprobacion de
// "esto es tuyo" es una comparacion de prefijo, no una lista de excepciones.
//
// Los recibos viejos (publicos) siguen leyendose por su URL directa hasta que la
// migracion del cliente los vuelve a subir privados; el barrido de api/backup.js
// borra despues los que quedan sin dueno.
import { put, issueSignedToken, presignUrl } from '@vercel/blob';
import { verifySupabaseUser, cors } from './_lib/web.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4_000_000;
const SIGNED_TTL_MS = 60 * 60 * 1000;   // 1h: lo que dura una sesion mirando la lista
const MAX_SIGN = 80;                    // firmas por tanda (la lista muestra ~50 filas)

// Un recibo vive bajo el prefijo de su usuario. Todo lo que este endpoint firma o
// acepta tiene que empezar con esto, o es de otro.
export function receiptPrefix(userId) {
  return 'receipts/' + String(userId) + '/';
}
// `..` explicito: el prefijo ya acota, pero un pathname con salto de directorio
// no tiene ningun uso legitimo aca.
export function ownsPath(pathname, userId) {
  return typeof pathname === 'string'
    && pathname.indexOf(receiptPrefix(userId)) === 0
    && pathname.indexOf('..') < 0;
}
// Nombre de archivo seguro: el usuario no lo elige (el cliente manda
// 'receipt.jpg'), pero el pathname se arma con el.
export function receiptPath(userId, filename) {
  // Los puntos seguidos se colapsan: sin esto un nombre como '../../x' quedaba
  // en '.._.._x' — inofensivo como archivo, pero ownsPath rechaza cualquier '..'
  // y el recibo nacia imposible de firmar.
  const safe = String(filename || 'receipt.jpg')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 60);
  return receiptPrefix(userId) + Date.now() + '-' + safe;
}

export default async function handler(req, res) {
  cors(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await verifySupabaseUser(req);
  if (!user || !user.id) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Blob not configured' });
  }

  if (req.method === 'POST') return upload(req, res, user);
  if (req.method === 'GET') return sign(req, res, user);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function upload(req, res, user) {
  const { filename, dataB64, contentType } = req.body || {};
  if (!filename || !dataB64 || !contentType) {
    return res.status(400).json({ error: 'filename, dataB64 and contentType required' });
  }
  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ error: 'Only image/jpeg, image/png or image/webp allowed' });
  }

  const buf = Buffer.from(dataB64, 'base64');
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Image too large' });

  try {
    const blob = await put(receiptPath(user.id, filename), buf, {
      access: 'private',
      contentType,
      addRandomSuffix: true,   // dos subidas en el mismo milisegundo no se pisan
    });
    // Solo el pathname: la url de un blob privado no sirve sin firma, y guardar
    // algo que parece un enlace permanente invita a volver a filtrarlo.
    res.status(200).json({ pathname: blob.pathname });
  } catch (e) {
    // Mensaje del SDK incluido a proposito: si el plan no permite blobs privados
    // hay que poder diagnosticarlo desde el aviso del cliente, no adivinarlo.
    res.status(500).json({ error: 'Upload failed: ' + String(e && e.message || e).slice(0, 200) });
  }
}

// Devuelve una URL firmada por cada pathname pedido. Una sola delegacion para
// toda la tanda (la lista puede traer decenas de miniaturas) y se firma cada
// pathname por separado: al cliente nunca le llega el token de delegacion, solo
// URLs que valen para UN recibo y una hora.
async function sign(req, res, user) {
  const raw = (req.query && (req.query.paths || req.query.path)) || '';
  const paths = String(raw).split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  if (!paths.length) return res.status(400).json({ error: 'paths required' });
  if (paths.length > MAX_SIGN) return res.status(400).json({ error: 'too many paths (max ' + MAX_SIGN + ')' });
  // Lo ajeno no da 403: da "no existe". Un 403 confirmaria que el recibo existe.
  const mine = paths.filter(function (p) { return ownsPath(p, user.id); });
  if (!mine.length) return res.status(200).json({ urls: {}, exp: 0 });

  try {
    const validUntil = Date.now() + SIGNED_TTL_MS;
    const token = await issueSignedToken({ pathname: '*', operations: ['get'], validUntil });
    const urls = {};
    for (const pathname of mine) {
      const signed = await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil: token.validUntil });
      urls[pathname] = signed.presignedUrl;
    }
    res.status(200).json({ urls, exp: token.validUntil });
  } catch (e) {
    res.status(500).json({ error: 'Sign failed: ' + String(e && e.message || e).slice(0, 200) });
  }
}
