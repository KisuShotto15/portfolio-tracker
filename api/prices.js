import { verifySupabaseUser, cors } from './_lib/web.js';

// Proxy de precios spot via CoinGecko. El cliente manda { ids:['bitcoin','ethereum',...] }
// (ids de CoinGecko) y recibe { bitcoin:{usd:65000}, ... }. Un solo request batcheado
// para todos los holdings; el cliente lo llama cada varias horas, no por cada moneda.
export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  // Sanea: solo ids validos de CoinGecko (letras, numeros y guiones), dedup, tope 100.
  const clean = [...new Set(ids.filter((s) => typeof s === 'string' && /^[a-z0-9-]+$/i.test(s)))].slice(0, 100);
  if (!clean.length) return res.status(400).json({ error: 'no valid ids' });

  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + clean.join(',') + '&vs_currencies=usd';
  const headers = {};
  // Demo key opcional: sin ella el endpoint publico igual responde (con rate limit mas bajo).
  if (process.env.COINGECKO_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_KEY;
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(502).json({ error: 'CoinGecko ' + r.status });
    const j = await r.json();
    return res.status(200).json(j);
  } catch (e) {
    return res.status(502).json({ error: 'price fetch failed' });
  }
}
