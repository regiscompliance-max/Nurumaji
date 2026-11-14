import { quoteFollowUpDetail, quoteFollowUpDue, quoteFollowUpSettingsFromStore, quoteFollowUpText } from "./quote-followups.mjs";
import { sendCustomerMessage } from "./sms";
import type { Bindings } from "./types";

type QuoteRow = {
  id: string;
  status: string;
  created_at: number;
  phone: string | null;
};

// Runs from the existing every-minute schedule. Client messages stay off until an admin switches them on.
export async function checkQuoteFollowUps(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const stored = await env.DB.prepare(
    `SELECT key, value FROM settings
     WHERE key IN ('quote_followup_days', 'quote_followup_final_days', 'quote_followup_sms', 'whatsapp_quote_template')`
  ).all<{ key: string; value: string }>();
  const settings = quoteFollowUpSettingsFromStore(Object.fromEntries((stored.results ?? []).map((row) => [row.key, row.value])));
  if (!settings.sms) return;
  let quotes: { results?: QuoteRow[] };
  let sent: { results?: { quote_id: string; kind: string }[] };
  try {
    quotes = await env.DB.prepare(
      `SELECT quotes.id, quotes.status, quotes.created_at, users.phone
       FROM quotes
       JOIN jobs ON jobs.id = quotes.job_id
       JOIN users ON users.id = jobs.client_id
       WHERE quotes.status = 'sent'`
    ).all<QuoteRow>();
    sent = await env.DB.prepare("SELECT quote_id, kind FROM quote_nudges").all<{ quote_id: string; kind: string }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      console.error("Quote follow-ups skipped until migration 0018 is applied.");
      return;
    }
    throw error;
  }
  const sentByQuote = new Map<string, string[]>();
  for (const row of sent.results ?? []) {
    const list = sentByQuote.get(row.quote_id) ?? [];
    list.push(row.kind);
    sentByQuote.set(row.quote_id, list);
  }
  for (const quote of quotes.results ?? []) {
    const kind = quoteFollowUpDue({
      now,
      sentAt: quote.created_at,
      status: quote.status,
      days: settings.days,
      finalDays: settings.finalDays,
      sentKinds: sentByQuote.get(quote.id) ?? [],
    });
    if (!kind || !quote.phone) continue;
    await sendCustomerMessage(env, quote.phone, quoteFollowUpText(kind), quoteFollowUpDetail(kind), settings.template);
    await env.DB.prepare(
      "INSERT INTO quote_nudges (id, quote_id, kind, sent_at) VALUES (?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), quote.id, kind, now).run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, NULL, 'quote_followup_sent', ?, ?)"
    ).bind(crypto.randomUUID(), JSON.stringify({ quoteId: quote.id, kind }), now).run();
  }
}
