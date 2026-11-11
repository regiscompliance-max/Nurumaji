import { daysPastDue, nairobiParts } from "./payments.mjs";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function shiftNairobiDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function nairobiMidnight(iso) {
  return Math.floor(Date.parse(`${iso}T00:00:00+03:00`) / 1000);
}

export function nairobiWeekday(iso) {
  return new Date(`${iso}T12:00:00+03:00`).getUTCDay();
}

export function reportWindow(kind, now) {
  const today = nairobiParts(now).date;
  const startToday = nairobiMidnight(today);
  const nextToday = nairobiMidnight(shiftNairobiDate(today, 1));
  if (kind === "yesterday") {
    const day = shiftNairobiDate(today, -1);
    return { kind, start: nairobiMidnight(day), end: startToday, label: day };
  }
  if (kind === "days7" || kind === "days30") {
    const span = kind === "days7" ? 7 : 30;
    const startDay = shiftNairobiDate(today, 1 - span);
    return { kind, start: nairobiMidnight(startDay), end: Math.min(now, nextToday), label: `${startDay} to ${today}` };
  }
  return { kind: "today", start: startToday, end: Math.min(now, nextToday), label: today };
}

// Daily digest is the previous Nairobi day, written during the 07:00 hour.
// Weekly digest is the previous Monday–Sunday, written on Monday during that same hour.
export function dueDigests(now) {
  const parts = nairobiParts(now);
  if (parts.hour !== 7) return [];
  const today = parts.date;
  const yesterday = shiftNairobiDate(today, -1);
  const due = [{
    period: "day",
    start: nairobiMidnight(yesterday),
    end: nairobiMidnight(today),
    label: yesterday,
  }];
  if (nairobiWeekday(today) === 1) {
    const monday = shiftNairobiDate(today, -7);
    const sunday = shiftNairobiDate(today, -1);
    due.push({
      period: "week",
      start: nairobiMidnight(monday),
      end: nairobiMidnight(today),
      label: `${monday} to ${sunday}`,
    });
  }
  return due;
}

export function snapshotMissing(savedStarts, periodStart) {
  return !savedStarts.includes(periodStart);
}

export function owedAt(invoices, windowEnd) {
  let owedKes = 0;
  let overdueKes = 0;
  for (const invoice of invoices) {
    if (invoice.status === "void") continue;
    if (invoice.issuedAt == null || invoice.issuedAt >= windowEnd) continue;
    if (invoice.paidAt != null && invoice.paidAt < windowEnd) continue;
    owedKes += invoice.amountKes;
    if (invoice.dueAt != null && daysPastDue(invoice.dueAt, windowEnd - 1) >= 1) overdueKes += invoice.amountKes;
  }
  return { owedKes, overdueKes };
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins < 90) return mins === 1 ? "1 min" : `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function digestText(period, stats) {
  const when = period === "week" ? "last week" : "yesterday";
  const money = (amount) => `KES ${Number(amount).toLocaleString("en-KE")}`;
  return `Nuru & Maji ${when}: ${stats.booked} booked, ${stats.completed} done, ${money(stats.collectedTotal)} collected, ${money(stats.overdueKes)} overdue, ${stats.stuckOpen} stuck.`;
}
