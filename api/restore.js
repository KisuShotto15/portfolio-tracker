// Restore de un backup diario a app_state. Protegido por CRON_SECRET (Bearer),
// igual que /api/backup. Dos modos:
//
//   GET  /api/restore                → lista los backups disponibles (usuario,
//        correo, fecha, cantidad de txs) para elegir cual restaurar.
//   POST /api/restore {user_id, taken_at} → sobreescribe app_state.doc de ese
//        usuario con el backup elegido. ANTES guarda el doc actual como un
//        backup nuevo (el restore mismo es reversible).
//
// IMPORTANTE (cliente): tras restaurar, en el dispositivo del usuario hay que
// Logout → Login. Si no, su localStorage (con timestamps mas nuevos) re-pisa el
// doc restaurado via LWW en el proximo push.
import crypto from 'node:crypto';

// Comparacion constant-time: hasheamos ambos lados a digest de largo fijo para
// que timingSafeEqual no tire por longitudes distintas.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers['authorization'] || '';
  if (!secret || !safeEqual(auth, 'Bearer ' + secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const SB_URL = process.env.SUPABASE_URL, SB_SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_SVC) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_KEY no configuradas' });
  const h = { apikey: SB_SVC, Authorization: 'Bearer ' + SB_SVC, 'Content-Type': 'application/json' };

  try {
    // Mapa user_id → email (GoTrue admin) para que la lista sea legible.
    const emails = {};
    try {
      const ur = await fetch(SB_URL + '/auth/v1/admin/users?per_page=100', { headers: h });
      if (ur.ok) ((await ur.json()).users || []).forEach((u) => { emails[u.id] = u.email; });
    } catch (e) {}

    if (req.method === 'GET') {
      const r = await fetch(SB_URL + '/rest/v1/app_state_backups?select=user_id,taken_at,doc&order=taken_at.desc&limit=100', { headers: h });
      if (!r.ok) throw new Error('read backups ' + r.status);
      const rows = await r.json();
      return res.status(200).json(rows.map((x) => ({
        user_id: x.user_id,
        email: emails[x.user_id] || null,
        taken_at: x.taken_at,
        txs: (x.doc && x.doc.transactions && x.doc.transactions.length) || 0,
      })));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { user_id, taken_at } = req.body || {};
    if (!user_id || !taken_at) return res.status(400).json({ error: 'user_id y taken_at requeridos' });

    const br = await fetch(SB_URL + '/rest/v1/app_state_backups?select=doc&user_id=eq.' + encodeURIComponent(user_id)
      + '&taken_at=eq.' + encodeURIComponent(taken_at), { headers: h });
    if (!br.ok) throw new Error('read backup ' + br.status);
    const backups = await br.json();
    if (!backups.length) return res.status(404).json({ error: 'backup no encontrado (user_id + taken_at exactos)' });

    // Red de seguridad: el doc ACTUAL se respalda antes de pisarlo.
    const cur = await fetch(SB_URL + '/rest/v1/app_state?select=doc&user_id=eq.' + encodeURIComponent(user_id), { headers: h });
    const curRows = cur.ok ? await cur.json() : [];
    if (curRows.length) {
      await fetch(SB_URL + '/rest/v1/app_state_backups', {
        method: 'POST', headers: h,
        body: JSON.stringify([{ user_id, doc: curRows[0].doc }]),
      }).catch(() => {});
    }

    const up = await fetch(SB_URL + '/rest/v1/app_state?on_conflict=user_id', {
      method: 'POST',
      headers: Object.assign({}, h, { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify([{ user_id, doc: backups[0].doc }]),
    });
    if (!up.ok) throw new Error('write app_state ' + up.status + ' ' + (await up.text()).slice(0, 200));
    return res.status(200).json({ ok: true, restored: taken_at, email: emails[user_id] || null,
      note: 'En el dispositivo del usuario: Logout -> Login para que tome el doc restaurado.' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
