import { put } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://portfolio.kisushotto.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiSecret = process.env.API_SECRET;
  if (!apiSecret || req.headers['x-api-secret'] !== apiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
    res.status(500).json({ error: 'Upload failed', detail: String(e && e.message || e) });
  }
}
