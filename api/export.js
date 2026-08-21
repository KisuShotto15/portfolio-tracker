// Export del doc de un usuario en crudo, para backups fuera de Supabase (lo usa
// el workflow semanal de KisuShotto15/portfolio-backups).
//
//   GET /api/export?email=<correo>   → { data: <doc> }
//
// Por que no reusar /api/sync: ese endpoint pide el JWT del usuario, y la app
// solo entrega JWTs por OTP de correo o passkey — las dos necesitan a una persona
// adelante, asi que un cron no puede autenticarse ahi. Este endpoint usa el mismo
// esquema que /api/backup y /api/restore: secret por Bearer con comparacion
// timing-safe, y la service key solo del lado del server.
//
// El secret es EXPORT_SECRET, propio de este endpoint, con fallback a CRON_SECRET.
// Separarlos importa: este valor vive en los secrets de un repo de GitHub, y
// CRON_SECRET tambien abre /api/restore, que SOBREESCRIBE el estado. Con un secret
// aparte, una filtracion del lado de CI deja leer un backup, nunca pisar los datos.
//
// Requiere env: SUPABASE_URL, SUPABASE_SERVICE_KEY, y EXPORT_SECRET (o CRON_SECRET).
import crypto from 'node:crypto';

// Comparacion constant-time: hasheamos ambos lados a digest de largo fijo para
// que timingSafeEqual no tire por longitudes distintas.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export default async function handler(req, res) {
  const secret = process.env.EXPORT_SECRET || process.env.CRON_SECRET || '';
  const auth = req.headers['authorization'] || '';
  if (!secret || !safeEqual(auth, 'Bearer ' + secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const SB_URL = process.env.SUPABASE_URL, SB_SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_SVC) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_KEY no configuradas' });
  const h = { apikey: SB_SVC, Authorization: 'Bearer ' + SB_SVC, 'Content-Type': 'application/json' };

  const email = (req.query && req.query.email) || '';

  try {
    let uid = '';
    if (email) {
      const ur = await fetch(SB_URL + '/auth/v1/admin/users?per_page=100', { headers: h });
      if (!ur.ok) throw new Error('read users ' + ur.status);
      const u = ((await ur.json()).users || []).find((x) => (x.email || '').toLowerCase() === String(email).toLowerCase());
      if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
      uid = u.id;
    }

    // Sin email: solo vale si hay UN unico usuario. Con varios seria ambiguo y
    // devolver el equivocado significa pisar un backup con datos de otra cuenta.
    const q = uid ? '?select=doc&user_id=eq.' + encodeURIComponent(uid) + '&limit=1' : '?select=doc&limit=2';
    const r = await fetch(SB_URL + '/rest/v1/app_state' + q, { headers: h });
    if (!r.ok) throw new Error('read app_state ' + r.status);
    const rows = await r.json();
    if (!rows.length) return res.status(404).json({ error: 'Sin datos para ese usuario' });
    if (!uid && rows.length > 1) return res.status(400).json({ error: 'Hay varios usuarios: pasa ?email=' });

    return res.status(200).json({ data: rows[0].doc });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
