// Backup diario de app_state → app_state_backups (lo dispara Vercel Cron, ver
// vercel.json). El doc de cada usuario vive en UNA fila JSONB y el LWW no tiene
// papelera: sin esto, un merge malo destruye datos sin restore point.
// Retencion: 30 dias (poda en el mismo run).
//
// Requiere env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service role: bypasea RLS;
// solo vive en el server), CRON_SECRET (Vercel lo manda como Bearer en los crons).
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret || (req.headers['authorization'] || '') !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const SB_URL = process.env.SUPABASE_URL, SB_SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_SVC) return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_KEY no configuradas' });
  const h = { apikey: SB_SVC, Authorization: 'Bearer ' + SB_SVC, 'Content-Type': 'application/json' };

  try {
    const r = await fetch(SB_URL + '/rest/v1/app_state?select=user_id,doc', { headers: h });
    if (!r.ok) throw new Error('read app_state ' + r.status);
    const rows = await r.json();
    if (rows.length) {
      const ins = await fetch(SB_URL + '/rest/v1/app_state_backups', {
        method: 'POST',
        headers: h,
        body: JSON.stringify(rows.map((x) => ({ user_id: x.user_id, doc: x.doc }))),
      });
      if (!ins.ok) throw new Error('insert backups ' + ins.status + ' ' + (await ins.text()).slice(0, 200));
    }
    // Poda: fuera todo lo mas viejo que 30 dias.
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await fetch(SB_URL + '/rest/v1/app_state_backups?taken_at=lt.' + encodeURIComponent(cutoff), {
      method: 'DELETE',
      headers: h,
    }).catch(() => {});
    return res.status(200).json({ ok: true, backed: rows.length });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
