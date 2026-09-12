// Backup diario de app_state → app_state_backups (lo dispara Vercel Cron, ver
// vercel.json). El doc de cada usuario vive en UNA fila JSONB y el LWW no tiene
// papelera: sin esto, un merge malo destruye datos sin restore point.
// Retencion: 30 dias (poda en el mismo run).
//
// Y de paso barre los recibos huerfanos: una imagen subida nunca se borraba, ni
// al borrar la transaccion ni al reemplazar la foto ni al cerrar el formulario a
// medias, asi que el store solo crecia con fotos que ya no se ven desde ningun
// lado. Se barre aca y no al borrar la tx por dos razones: el undo tiene que
// poder devolver la transaccion CON su foto, y este es el unico lugar que ya lee
// los docs de todos los usuarios (hace falta: un blob no dice de quien es).
//
// Requiere env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service role: bypasea RLS;
// solo vive en el server), CRON_SECRET (Vercel lo manda como Bearer en los crons).
import crypto from 'node:crypto';
import { list, del } from '@vercel/blob';

// Comparacion constant-time: hasheamos ambos lados a digest de largo fijo para
// que timingSafeEqual no tire por longitudes distintas.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Gracia antes de borrar un recibo sin dueno. Un dispositivo que estuvo dias sin
// conexion todavia no subio la transaccion que lo referencia: con menos margen, su
// foto desaparece antes de que el doc llegue a la nube.
const ORPHAN_GRACE_MS = 30 * 24 * 3600 * 1000;

// Un pathname puede estar referenciado por el campo nuevo (receiptPath) o por la
// URL publica vieja (receiptUrl), que lleva el pathname adentro.
export function referencedPaths(docs) {
  const seen = new Set();
  (docs || []).forEach(function (doc) {
    const txs = (doc && doc.transactions) || [];
    txs.forEach(function (t) {
      if (!t) return;
      if (t.receiptPath) seen.add(String(t.receiptPath));
      if (t.receiptUrl) {
        try {
          seen.add(decodeURIComponent(new URL(String(t.receiptUrl)).pathname).replace(/^\/+/, ''));
        } catch (e) { /* url rota: no referencia nada */ }
      }
    });
  });
  return seen;
}

// Se mira contra los docs de TODOS los usuarios a la vez, no uno por uno: los
// recibos viejos no llevan usuario en el pathname, asi que preguntarle a un solo
// doc si es suyo borraria los de los demas.
async function sweepReceipts(rows) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const keep = referencedPaths((rows || []).map(function (r) { return r.doc; }));
  const cut = Date.now() - ORPHAN_GRACE_MS;
  let cursor, borrados = 0;
  do {
    const page = await list({ prefix: 'receipts/', cursor, limit: 1000 });
    const viejos = page.blobs.filter(function (b) {
      return !keep.has(b.pathname) && new Date(b.uploadedAt).getTime() < cut;
    });
    if (viejos.length) {
      await del(viejos.map(function (b) { return b.url; }));
      borrados += viejos.length;
    }
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  if (borrados) console.log('recibos huerfanos borrados:', borrados);
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
    try { await sweepReceipts(rows); } catch (e) { console.warn('sweep recibos:', e && e.message); }
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
