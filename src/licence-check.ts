import { sendSms } from "./sms";
import type { Bindings } from "./types";

// Runs from the existing every-minute schedule, at most once per Nairobi day.
export async function licenceCheck(env: Bindings): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'licence_check_on'").first<{ value: string }>();
  if (last?.value === today) return;
  const docs = await env.DB.prepare(
    `SELECT technician_documents.id, technician_documents.user_id, technician_documents.doc_type,
            technician_documents.expiry_date, users.phone, technician_profiles.approved
     FROM technician_documents
     JOIN users ON users.id = technician_documents.user_id
     LEFT JOIN technician_profiles ON technician_profiles.user_id = technician_documents.user_id
     WHERE technician_documents.expiry_date IS NOT NULL`
  ).all<{ id: string; user_id: string; doc_type: string; expiry_date: string; phone: string; approved: number | null }>();
  const todayMs = Date.parse(`${today}T00:00:00+03:00`);
  for (const doc of docs.results ?? []) {
    const expiryMs = Date.parse(`${doc.expiry_date}T00:00:00+03:00`);
    if (!Number.isFinite(expiryMs)) continue;
    const days = Math.round((expiryMs - todayMs) / 86_400_000);
    if (days === 30 || days === 7) await remind(env, doc, days);
    if (days < 0 && doc.approved === 1) await expireLicence(env, doc);
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('licence_check_on', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(today).run();
}

async function remind(env: Bindings, doc: { id: string; user_id: string; phone: string }, days: number) {
  const prior = await env.DB.prepare(
    "SELECT id FROM audit_log WHERE action = 'licence_reminder' AND json_extract(details_json, '$.documentId') = ? AND json_extract(details_json, '$.days') = ? LIMIT 1"
  ).bind(doc.id, days).first();
  if (prior) return;
  await sendSms(env, doc.phone, `Nuru & Maji: a licence on your profile expires in ${days} days. Upload the renewal in the portal.`);
  await env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, NULL, 'licence_reminder', ?, ?)"
  ).bind(crypto.randomUUID(), JSON.stringify({ documentId: doc.id, days }), Math.floor(Date.now() / 1000)).run();
}

async function expireLicence(env: Bindings, doc: { id: string; user_id: string; phone: string }) {
  const prior = await env.DB.prepare(
    "SELECT id FROM audit_log WHERE action = 'licence_expired' AND json_extract(details_json, '$.documentId') = ? LIMIT 1"
  ).bind(doc.id).first();
  await env.DB.prepare("UPDATE technician_profiles SET approved = 0 WHERE user_id = ?").bind(doc.user_id).run();
  if (prior) return;
  await sendSms(env, doc.phone, "Nuru & Maji: a licence on your profile has expired. You will not receive new offers until an admin checks the renewal.");
  await env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, NULL, 'licence_expired', ?, ?)"
  ).bind(crypto.randomUUID(), JSON.stringify({ documentId: doc.id }), Math.floor(Date.now() / 1000)).run();
}
