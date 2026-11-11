export const PAYMENT_DEFAULTS = {
  dueDays: 7,
  offsets: [0, 3, 7],
  sms: false,
};

const PAY_LINE = "Payment through the site is not switched on. An operator records it when it has been received.";

function wholeNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function nairobiParts(seconds) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(seconds * 1000)).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: hour === 24 ? 0 : hour,
  };
}

function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

// Calendar days after the due date in Nairobi. Negative means it is not due yet.
export function daysPastDue(dueAt, now) {
  return dayNumber(nairobiParts(now).date) - dayNumber(nairobiParts(dueAt).date);
}

export function owedBucket(days) {
  if (days < 0) return null;
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  return "30+";
}

export function parseOffsets(value) {
  const parts = String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 6) return { error: "Enter up to six reminder days, separated by commas." };
  const offsets = [];
  for (const part of parts) {
    const parsed = wholeNumber(part);
    if (parsed == null || parsed > 90) return { error: "Reminder days must be whole numbers from 0 to 90." };
    offsets.push(parsed);
  }
  const unique = [...new Set(offsets)].sort((left, right) => left - right);
  if (unique.length !== offsets.length) return { error: "Each reminder day can be listed once." };
  return { offsets: unique };
}

export function parsePaymentSettings(input) {
  const dueDays = wholeNumber(input.dueDays);
  if (dueDays == null || dueDays < 1 || dueDays > 90) return { ok: false, error: "Due days must be a whole number from 1 to 90." };
  const parsed = parseOffsets(input.offsets);
  if (parsed.error) return { ok: false, error: parsed.error };
  const sms = input.sms === true || input.sms === "1" || input.sms === "on";
  return { ok: true, dueDays, offsets: parsed.offsets, sms };
}

export function paymentSettingsFromStore(values) {
  const parsed = parsePaymentSettings({
    dueDays: values.invoice_due_days ?? String(PAYMENT_DEFAULTS.dueDays),
    offsets: values.payment_reminder_offsets ?? PAYMENT_DEFAULTS.offsets.join(","),
    sms: values.payment_reminders_sms === "1",
  });
  if (!parsed.ok) return { ...PAYMENT_DEFAULTS, offsets: [...PAYMENT_DEFAULTS.offsets] };
  return { dueDays: parsed.dueDays, offsets: parsed.offsets, sms: parsed.sms };
}

// The latest offset that has been reached, and only if that one has not been sent.
// Missed earlier offsets are not sent afterwards. Nothing goes out before 08:00 or from 19:00.
export function reminderToSend({ now, dueAt, status, paused, offsets, sentOffsets }) {
  if (status !== "unpaid" || paused || dueAt == null) return null;
  const hour = nairobiParts(now).hour;
  if (hour < 8 || hour >= 19) return null;
  const past = daysPastDue(dueAt, now);
  if (past < 0) return null;
  const reached = offsets.filter((offset) => offset <= past);
  if (!reached.length) return null;
  const latest = Math.max(...reached);
  if (sentOffsets.includes(latest)) return null;
  return latest;
}

export function invoiceReference(id) {
  return String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function paymentReminderText({ reference, amountKes, offsetDays }) {
  const amount = Number(amountKes).toLocaleString("en-KE");
  const state = offsetDays > 0 ? "is still due" : "is due";
  return `Nuru & Maji: invoice ${reference} for KES ${amount} ${state}. ${PAY_LINE}`;
}
