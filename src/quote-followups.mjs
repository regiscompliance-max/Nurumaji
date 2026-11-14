import { daysPastDue, nairobiParts } from "./payments.mjs";

export const QUOTE_FOLLOWUP_DEFAULTS = {
  days: 3,
  finalDays: null,
  sms: false,
  template: "nurumaji_quote_followup",
};

function wholeNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseQuoteFollowUpSettings(input) {
  const days = wholeNumber(input.days);
  if (days == null || days < 1 || days > 30) return { ok: false, error: "The first reminder must be a whole number of days from 1 to 30." };
  const rawFinal = String(input.finalDays ?? "").trim();
  let finalDays = null;
  if (rawFinal) {
    finalDays = wholeNumber(rawFinal);
    if (finalDays == null || finalDays < 1 || finalDays > 90) return { ok: false, error: "The last reminder must be a whole number of days from 1 to 90, or left blank." };
    if (finalDays <= days) return { ok: false, error: "The last reminder must be later than the first." };
  }
  const rawTemplate = String(input.template ?? "").trim();
  if (rawTemplate && !/^[a-z0-9_]{1,64}$/.test(rawTemplate)) return { ok: false, error: "The template name can use lowercase letters, numbers, and underscores." };
  const sms = input.sms === true || input.sms === "1" || input.sms === "on";
  return { ok: true, days, finalDays, sms, template: rawTemplate || QUOTE_FOLLOWUP_DEFAULTS.template };
}

export function quoteFollowUpSettingsFromStore(values) {
  const parsed = parseQuoteFollowUpSettings({
    days: values.quote_followup_days ?? String(QUOTE_FOLLOWUP_DEFAULTS.days),
    finalDays: values.quote_followup_final_days ?? "",
    sms: values.quote_followup_sms === "1",
    template: values.whatsapp_quote_template,
  });
  if (!parsed.ok) return { ...QUOTE_FOLLOWUP_DEFAULTS };
  return { days: parsed.days, finalDays: parsed.finalDays, sms: parsed.sms, template: parsed.template };
}

// One first reminder after the waiting days, then one last reminder if that interval is set.
// An accepted or declined quote is skipped. Nothing goes out before 08:00 or from 19:00 Nairobi.
export function quoteFollowUpDue({ now, sentAt, status, days, finalDays, sentKinds }) {
  if (status !== "sent" || sentAt == null) return null;
  const hour = nairobiParts(now).hour;
  if (hour < 8 || hour >= 19) return null;
  const waiting = daysPastDue(sentAt, now);
  if (waiting < days) return null;
  if (!sentKinds.includes("first")) return "first";
  if (finalDays == null || waiting < finalDays || sentKinds.includes("final")) return null;
  return "final";
}

export function quoteFollowUpText(kind) {
  if (kind === "final") return "Nuru & Maji: this is a last reminder. Your quote is still waiting. Sign in to accept or decline it.";
  return "Nuru & Maji: your quote is still waiting. Sign in to accept or decline it.";
}

export function quoteFollowUpDetail(kind) {
  return kind === "final" ? "a last reminder" : "still waiting";
}
