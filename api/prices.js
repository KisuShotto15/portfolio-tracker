// Verifica el JWT de Supabase (mismo patron que sync.js). Devuelve el user o null.
async function verifySupabaseUser(req) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) return null;
  const jwt = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + jwt } });
  if (!r.ok) return null;
  return await r.json();
}

// Proxy de precios spot via CoinGecko. El cliente manda { ids:['bitcoin','ethereum',...] }
// (ids de CoinGecko) y recibe { bitcoin:{usd:65000}, ... }. Un solo request batcheado
// para todos los holdings; el cliente lo llama cada varias horas, no por cada moneda.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
