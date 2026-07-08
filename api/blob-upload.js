import { put } from '@vercel/blob';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await verifySupabaseUser(req))) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Blob not configured' });
  }

  const { filename, dataB64, contentType } = req.body || {};
  if (!filename || !dataB64 || !contentType) {
    return res.status(400).json({ error: 'filename, dataB64 and contentType required' });
  }
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ error: 'Only images allowed' });
  }

  const buf = Buffer.from(dataB64, 'base64');
  if (buf.length > 4_000_000) {
    return res.status(413).json({ error: 'Image too large' });
  }

  try {
    const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await put('receipts/' + Date.now() + '-' + safe, buf, {
      access: 'public',
      contentType,
    });
    res.status(200).json({ url: blob.url });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed' });
  }
}
