// Lee una foto de recibo (o, mas seguido aca, la captura de una confirmacion de
// pago movil) y devuelve monto, moneda, fecha y comercio para que el formulario
// de nueva transaccion arranque lleno. La foto NO se guarda: entra, se lee, se
// descarta. La que se guarda es la que sube blob-upload, privada y aparte.
//
// La imagen sale del dispositivo hacia la API de Anthropic. Es la unica parte de
// la app que le manda una foto tuya a un tercero, y por eso es opcional: sin
// ANTHROPIC_API_KEY configurada este endpoint responde 503 y el formulario sigue
// funcionando como siempre, escribiendo a mano.
import Anthropic from '@anthropic-ai/sdk';
import { verifySupabaseUser, cors } from './_lib/web.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4_000_000;

// Esquema plano y sin nulls a proposito: `strict` garantiza que lo que vuelve
// valida contra esto, y cuanto mas simple sea el esquema menos hay que adivinar
// sobre como lo trata el modelo. Lo que no se pudo leer vuelve en cero o vacio, y
// el servidor lo descarta abajo.
const TOOL = {
  name: 'extract_receipt',
  description: 'Reports what a receipt or payment confirmation says. Use empty string / 0 for anything not clearly readable.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'true only if this image really is a receipt, invoice or payment confirmation' },
      amount: { type: 'number', description: 'TOTAL actually paid, not a subtotal or an item price. 0 if unreadable' },
      currency: { type: 'string', enum: ['USD', 'VES', 'OTHER', 'UNKNOWN'], description: 'VES for bolivares (Bs), USD for dollars' },
      date: { type: 'string', description: 'Date on the receipt as YYYY-MM-DD, or empty string' },
      merchant: { type: 'string', description: 'Short merchant or beneficiary name, or empty string' },
    },
    required: ['found', 'amount', 'currency', 'date', 'merchant'],
    additionalProperties: false,
  },
};

const PROMPT = [
  'This image is a receipt, an invoice, or a mobile-payment confirmation (often a Venezuelan "pago movil" screenshot).',
  'Report what it says with the extract_receipt tool.',
  'The amount must be the TOTAL actually paid — not a subtotal, not a single line item, not a balance.',
  'Bolivares are written "Bs", "Bs.", "BsS" or "VES"; that is currency VES. Dollars are USD.',
  'Venezuelan amounts use a comma as the decimal separator: "1.234,56" is 1234.56.',
  'If the image is not a receipt at all, set found=false and leave everything empty.',
].join(' ');

// La fecha solo se acepta si es plausible: un OCR que lee mal el anio puede
// mandar el gasto a 2019 o a 2031, y en el formulario eso se nota tarde.
export function cleanDate(raw, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw || ''))) return '';
  const t = Date.parse(raw + 'T12:00:00');
  if (isNaN(t)) return '';
  const hoy = now || Date.now();
  if (t > hoy + 24 * 3600 * 1000) return '';               // del futuro: no
  if (t < hoy - 400 * 24 * 3600 * 1000) return '';         // mas de un anio atras: tampoco
  return raw;
}

// Lo que devuelve el modelo pasa por aca antes de llegar al cliente: es texto de
// una foto, no un dato de la app.
export function cleanExtraction(x, now) {
  const o = x || {};
  const amount = Number(o.amount);
  const cur = o.currency === 'VES' ? 'VES' : o.currency === 'USD' ? 'USD' : '';
  return {
    found: o.found === true,
    amount: isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    currency: cur,
    date: cleanDate(o.date, now),
    merchant: String(o.merchant || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  };
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await verifySupabaseUser(req);
  if (!user || !user.id) return res.status(401).json({ error: 'Unauthorized' });
  // 503 y no 500: no esta roto, es que esta funcion es opcional y no se configuro.
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Reading receipts is not configured' });

  const { dataB64, contentType } = req.body || {};
  if (!dataB64 || !contentType) return res.status(400).json({ error: 'dataB64 and contentType required' });
  if (!ALLOWED_TYPES.includes(contentType)) return res.status(400).json({ error: 'Only image/jpeg, image/png or image/webp allowed' });
  if (Buffer.from(dataB64, 'base64').length > MAX_BYTES) return res.status(413).json({ error: 'Image too large' });

  try {
    const client = new Anthropic();
    const r = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      // Leer un numero de una imagen no necesita pensar mucho, y esto se espera
      // con el formulario abierto: el esfuerzo bajo es latencia y costo.
      output_config: { effort: 'low' },
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: dataB64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    const bloque = (r.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
    if (!bloque) return res.status(200).json({ found: false, amount: 0, currency: '', date: '', merchant: '' });
    return res.status(200).json(cleanExtraction(bloque.input, Date.now()));
  } catch (e) {
    // El mensaje viaja al cliente para que un problema de configuracion (clave
    // vencida, sin credito) se pueda diagnosticar desde el aviso del formulario.
    return res.status(502).json({ error: 'Could not read the receipt: ' + String(e && e.message || e).slice(0, 200) });
  }
}
