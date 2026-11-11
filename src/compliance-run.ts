import { dispatchHold, documentLabel, daysUntilExpiry, reminderOffset } from "./compliance.mjs";

const TYPES = new Set(["id", "insurance", "licence", "certificate"]);

export async function recordComplianceDocument(env: Bindings, input: {
  userId: string;
  docType: string;
  expiryDate: string;
  actorId: string;
  asAdmin: boolean;
}): Promise<{ error?: string; ok?: boolean }> {
  if (!TYPES.has(input.docType)) return { error: "Choose ID, insurance, licence, or certificate." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) return { error: "Enter the expiry date." };
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "UPDATE compliance_documents SET replaced_at = ? WHERE user_id = ? AND doc_type = ? AND replaced_at IS NULL"
  ).bind(now, input.userId, input.docType).run();
  await env.DB.prepare(
    `INSERT INTO compliance_documents (id, user_id, doc_type, expiry_date, recorded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), input.userId, input.docType, input.expiryDate, input.actorId, now).run();
  const docs = await env.DB.prepare(
    "SELECT doc_type, expiry_date FROM compliance_documents WHERE user_id = ? AND replaced_at IS NULL"
  ).bind(input.userId).all<{ doc_type: string; expiry_date: string }>();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const hold = dispatchHold((docs.results ?? []).map((doc) => ({ docType: doc.doc_type, expiryDate: doc.expiry_date })), today);
  if (input.asAdmin || hold) {
    await env.DB.prepare("UPDATE technician_profiles SET dispatch_hold = ? WHERE user_id = ?").bind(hold, input.userId).run();
  }
  return { ok: true };
}
import { sendSms } from "./sms";
import type { Bindings } from "./types";

type DocRow = { id: string; user_id: string; doc_type: string; expiry_date: string };

export async function complianceCheck(env: Bindings): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'compliance_check_on'").first<{ value: string }>();
  if (last?.value === today) return;
  const smsOn = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'compliance_sms'").first<{ value: string }>())?.value === "1";
  let docs: { results?: DocRow[] };
  let techs: { results?: { user_id: string; phone: string; name: string | null }[] };
  try {
    docs = await env.DB.prepare(
      `SELECT id, user_id, doc_type, expiry_date FROM compliance_documents WHERE replaced_at IS NULL`
    ).all<DocRow>();
    techs = await env.DB.prepare(
      `SELECT technician_profiles.user_id, users.phone, users.name
       FROM technician_profiles JOIN users ON users.id = technician_profiles.user_id
       WHERE users.role = 'technician' AND technician_profiles.approved = 1`
    ).all<{ user_id: string; phone: string; name: string | null }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("no such column")) return;
    throw error;
  }
  const byUser = new Map<string, DocRow[]>();
  for (const doc of docs.results ?? []) {
    const list = byUser.get(doc.user_id) ?? [];
    list.push(doc);
    byUser.set(doc.user_id, list);
  }
  const operators = smsOn
    ? (await env.DB.prepare("SELECT phone FROM users WHERE role IN ('operator', 'admin') AND status = 'active'").all<{ phone: string }>()).results ?? []
    : [];
  const now = Math.floor(Date.now() / 1000);
  for (const tech of techs.results ?? []) {
    const own = byUser.get(tech.user_id) ?? [];
    const hold = dispatchHold(own.map((doc) => ({ docType: doc.doc_type, expiryDate: doc.expiry_date })), today);
    await env.DB.prepare("UPDATE technician_profiles SET dispatch_hold = ? WHERE user_id = ?").bind(hold, tech.user_id).run();
    for (const doc of own) {
      const offset = reminderOffset(daysUntilExpiry(doc.expiry_date, today));
      if (offset == null) continue;
      const prior = await env.DB.prepare(
        "SELECT id FROM compliance_reminders WHERE document_id = ? AND days = ?"
      ).bind(doc.id, offset).first();
      if (prior) continue;
      await env.DB.prepare(
        "INSERT INTO compliance_reminders (id, document_id, user_id, days, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), doc.id, tech.user_id, offset, now).run();
      if (!smsOn) continue;
      const label = documentLabel(doc.doc_type);
      await sendSms(env, tech.phone, `Nuru & Maji: your ${label.toLowerCase()} expires in ${offset} days. Update it in the portal.`);
      for (const person of operators) {
        await sendSms(env, person.phone, `Nuru & Maji: ${tech.name || "A technician"} has a ${label.toLowerCase()} expiring in ${offset} days.`);
      }
    }
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('compliance_check_on', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(today).run();
}
