import { invoiceReference, nairobiParts, paymentReminderText, paymentSettingsFromStore, reminderToSend } from "./payments.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

type InvoiceRow = {
  id: string;
  amount_kes: number;
  due_at: number | null;
  status: string;
  reminders_paused: number;
  phone: string | null;
};

// Runs from the existing every-minute schedule. Client texts stay off until an admin switches them on.
export async function checkPaymentReminders(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const stored = await env.DB.prepare(
    `SELECT key, value FROM settings
     WHERE key IN ('invoice_due_days', 'payment_reminder_offsets', 'payment_reminders_sms')`
  ).all<{ key: string; value: string }>();
  const settings = paymentSettingsFromStore(Object.fromEntries((stored.results ?? []).map((row) => [row.key, row.value])));
  const hour = nairobiParts(now).hour;
  if (!settings.sms || hour < 8 || hour >= 19) return;
  let invoices: { results?: InvoiceRow[] };
  let sent: { results?: { invoice_id: string; offset_days: number }[] };
  try {
    invoices = await env.DB.prepare(
      `SELECT invoices.id, invoices.amount_kes, invoices.due_at, invoices.status, invoices.reminders_paused,
              users.phone
       FROM invoices
       JOIN jobs ON jobs.id = invoices.job_id
       JOIN users ON users.id = jobs.client_id
       WHERE invoices.status = 'unpaid' AND invoices.reminders_paused = 0 AND invoices.due_at IS NOT NULL`
    ).all<InvoiceRow>();
    sent = await env.DB.prepare(
      "SELECT invoice_id, offset_days FROM invoice_reminders"
    ).all<{ invoice_id: string; offset_days: number }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("no such column")) {
      console.error("Payment reminders skipped until migration 0009 is applied.");
      return;
    }
    throw error;
  }
  const sentByInvoice = new Map<string, number[]>();
  for (const row of sent.results ?? []) {
    const list = sentByInvoice.get(row.invoice_id) ?? [];
    list.push(row.offset_days);
    sentByInvoice.set(row.invoice_id, list);
  }
  for (const invoice of invoices.results ?? []) {
    const offset = reminderToSend({
      now,
      dueAt: invoice.due_at,
      status: invoice.status,
      paused: invoice.reminders_paused === 1,
      offsets: settings.offsets,
      sentOffsets: sentByInvoice.get(invoice.id) ?? [],
    });
    if (offset == null || !invoice.phone) continue;
    const text = paymentReminderText({
      reference: invoiceReference(invoice.id),
      amountKes: invoice.amount_kes,
      offsetDays: offset,
    });
    await sendSms(env, invoice.phone, text);
    await env.DB.prepare(
      "INSERT INTO invoice_reminders (id, invoice_id, offset_days, sent_at) VALUES (?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), invoice.id, offset, now).run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, NULL, 'payment_reminder_sent', ?, ?)"
    ).bind(crypto.randomUUID(), JSON.stringify({ invoiceId: invoice.id, offsetDays: offset }), now).run();
  }
}
