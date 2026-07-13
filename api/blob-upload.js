import { put } from '@vercel/blob';
import { verifySupabaseUser, cors } from './_lib/web.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default async function handler(req, res) {
  cors(res);

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
  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ error: 'Only image/jpeg, image/png or image/webp allowed' });
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
