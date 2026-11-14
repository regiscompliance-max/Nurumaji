import { digestText, dueDigests, owedAt, snapshotMissing } from "./reports.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

export type ReportStats = {
  booked: number;
  completed: number;
  cancelled: number;
  open: number;
  stuckOpen: number;
  sheetsPassed: number;
  sheetsFailed: number;
  invoicesIssued: number;
  invoicesIssuedKes: number;
  collected: { method: string; amountKes: number }[];
  collectedTotal: number;
  owedKes: number;
  overdueKes: number;
  quotesSent: number;
  quotesAccepted: number;
  quoteNudges: number;
  applications: number;
  lowRatings: number;
  bookingToAssignedSeconds: number | null;
  assignedToCompletedSeconds: number | null;
  technicians: { name: string; completed: number; rating: number | null }[];
};

type CountRow = { n: number | null };
type InvoiceRow = {
  amount_kes: number;
  due_at: number | null;
  paid_at: number | null;
  status: string;
  issued_at: number | null;
};

function count(row: CountRow | null): number {
  return Number(row?.n ?? 0) || 0;
}

export async function loadReport(env: Bindings, start: number, end: number): Promise<ReportStats> {
  const db = env.DB;
  const booked = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE created_at >= ? AND created_at < ?").bind(start, end).first<CountRow>();
  const completed = await db.prepare(
    "SELECT COUNT(DISTINCT job_id) AS n FROM job_events WHERE type = 'completed' AND created_at >= ? AND created_at < ?"
  ).bind(start, end).first<CountRow>();
  const cancelled = await db.prepare(
    "SELECT COUNT(*) AS n FROM jobs WHERE status = 'cancelled' AND updated_at >= ? AND updated_at < ?"
  ).bind(start, end).first<CountRow>();
  const open = await db.prepare(
    `SELECT COUNT(*) AS n FROM jobs
     WHERE created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM job_events
         WHERE job_events.job_id = jobs.id
           AND job_events.type IN ('completed', 'invoiced', 'paid')
           AND job_events.created_at < ?
       )
       AND NOT (status = 'cancelled' AND updated_at < ?)`
  ).bind(end, end, end).first<CountRow>();
  const stuck = await db.prepare(
    `SELECT COUNT(*) AS n FROM job_alerts
     WHERE opened_at < ?
       AND (acknowledged_at IS NULL OR acknowledged_at >= ?)
       AND (resolved_at IS NULL OR resolved_at >= ?)`
  ).bind(end, end, end).first<CountRow>();
  const sheets = await db.prepare(
    "SELECT result, COUNT(*) AS n FROM job_test_sheets WHERE created_at >= ? AND created_at < ? GROUP BY result"
  ).bind(start, end).all<{ result: string; n: number }>();
  const issued = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_kes), 0) AS amount
     FROM (
       SELECT invoices.amount_kes, MIN(job_events.created_at) AS issued_at
       FROM invoices
       JOIN job_events ON job_events.job_id = invoices.job_id AND job_events.type = 'invoiced'
       WHERE invoices.status != 'void'
       GROUP BY invoices.id
     )
     WHERE issued_at >= ? AND issued_at < ?`
  ).bind(start, end).first<{ n: number; amount: number }>();
  const collectedRows = await db.prepare(
    `SELECT COALESCE(payment_method, '') AS method, COALESCE(SUM(amount_kes), 0) AS amount
     FROM invoices
     WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?
     GROUP BY payment_method
     ORDER BY method`
  ).bind(start, end).all<{ method: string; amount: number }>();
  const quotesSent = await db.prepare(
    "SELECT COUNT(*) AS n FROM quotes WHERE status IN ('sent', 'approved', 'rejected') AND created_at >= ? AND created_at < ?"
  ).bind(start, end).first<CountRow>();
  const quotesAccepted = await db.prepare(
    "SELECT COUNT(*) AS n FROM job_events WHERE type = 'quote_approved' AND created_at >= ? AND created_at < ?"
  ).bind(start, end).first<CountRow>();
  let quoteNudges = 0;
  try {
    const nudged = await db.prepare(
      "SELECT COUNT(*) AS n FROM quote_nudges WHERE sent_at >= ? AND sent_at < ?"
    ).bind(start, end).first<CountRow>();
    quoteNudges = count(nudged);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("no such table")) throw error;
  }
  const applications = await db.prepare(
    "SELECT COUNT(*) AS n FROM technician_applications WHERE created_at >= ? AND created_at < ?"
  ).bind(start, end).first<CountRow>();
  const lowRatings = await db.prepare(
    "SELECT COUNT(*) AS n FROM ratings WHERE score <= 2 AND created_at >= ? AND created_at < ?"
  ).bind(start, end).first<CountRow>();
  const toAssigned = await db.prepare(
    `SELECT AVG(first_assigned - jobs.created_at) AS n
     FROM jobs
     JOIN (SELECT job_id, MIN(created_at) AS first_assigned FROM job_events WHERE type = 'assigned' GROUP BY job_id) AS assigned
       ON assigned.job_id = jobs.id
     WHERE assigned.first_assigned >= ? AND assigned.first_assigned < ?`
  ).bind(start, end).first<CountRow>();
  const toCompleted = await db.prepare(
    `SELECT AVG(done.completed_at - assigned.first_assigned) AS n
     FROM (SELECT job_id, MIN(created_at) AS completed_at FROM job_events WHERE type = 'completed' GROUP BY job_id) AS done
     JOIN (SELECT job_id, MIN(created_at) AS first_assigned FROM job_events WHERE type = 'assigned' GROUP BY job_id) AS assigned
       ON assigned.job_id = done.job_id
     WHERE done.completed_at >= ? AND done.completed_at < ?`
  ).bind(start, end).first<CountRow>();
  const technicians = await db.prepare(
    `SELECT users.name AS name, COUNT(DISTINCT jobs.id) AS completed,
            (SELECT ROUND(AVG(score), 1) FROM ratings WHERE tech_id = users.id) AS rating
     FROM job_events
     JOIN jobs ON jobs.id = job_events.job_id
     JOIN users ON users.id = jobs.assigned_tech_id
     WHERE job_events.type = 'completed' AND job_events.created_at >= ? AND job_events.created_at < ?
     GROUP BY users.id
     ORDER BY completed DESC, users.name`
  ).bind(start, end).all<{ name: string | null; completed: number; rating: number | null }>();
  const invoiceRows = await db.prepare(
    `SELECT invoices.amount_kes, invoices.due_at, invoices.paid_at, invoices.status,
            (SELECT MIN(created_at) FROM job_events WHERE job_id = invoices.job_id AND type = 'invoiced') AS issued_at
     FROM invoices
     WHERE invoices.status != 'void'`
  ).all<InvoiceRow>();
  const owed = owedAt((invoiceRows.results ?? []).map((row) => ({
    status: row.status,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
    dueAt: row.due_at,
    amountKes: row.amount_kes,
  })), end);
  const collected = (collectedRows.results ?? []).map((row) => ({ method: row.method, amountKes: Number(row.amount) || 0 }));
  const passed = (sheets.results ?? []).find((row) => row.result === "pass");
  const failed = (sheets.results ?? []).find((row) => row.result === "fail");
  return {
    booked: count(booked),
    completed: count(completed),
    cancelled: count(cancelled),
    open: count(open),
    stuckOpen: count(stuck),
    sheetsPassed: Number(passed?.n ?? 0) || 0,
    sheetsFailed: Number(failed?.n ?? 0) || 0,
    invoicesIssued: Number(issued?.n ?? 0) || 0,
    invoicesIssuedKes: Number(issued?.amount ?? 0) || 0,
    collected,
    collectedTotal: collected.reduce((sum, row) => sum + row.amountKes, 0),
    owedKes: owed.owedKes,
    overdueKes: owed.overdueKes,
    quotesSent: count(quotesSent),
    quotesAccepted: count(quotesAccepted),
    quoteNudges,
    applications: count(applications),
    lowRatings: count(lowRatings),
    bookingToAssignedSeconds: toAssigned?.n == null ? null : Number(toAssigned.n),
    assignedToCompletedSeconds: toCompleted?.n == null ? null : Number(toCompleted.n),
    technicians: (technicians.results ?? []).map((row) => ({
      name: row.name || "Technician",
      completed: Number(row.completed) || 0,
      rating: row.rating == null ? null : Number(row.rating),
    })),
  };
}

// Runs from the existing every-minute schedule. A period is written once, during the 07:00 Nairobi hour.
export async function writeDigests(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = dueDigests(now);
  if (!due.length) return;
  let saved: { results?: { period: string; period_start: number }[] };
  try {
    saved = await env.DB.prepare("SELECT period, period_start FROM report_snapshots").all<{ period: string; period_start: number }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      console.error("Digests skipped until migration 0010 is applied.");
      return;
    }
    throw error;
  }
  const settings = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('digest_daily_sms', 'digest_weekly_sms')"
  ).all<{ key: string; value: string }>();
  const flags = Object.fromEntries((settings.results ?? []).map((row) => [row.key, row.value]));
  for (const slot of due) {
    const already = (saved.results ?? []).filter((row) => row.period === slot.period).map((row) => row.period_start);
    if (!snapshotMissing(already, slot.start)) continue;
    const stats = await loadReport(env, slot.start, slot.end);
    await env.DB.prepare(
      `INSERT INTO report_snapshots (id, period, period_start, period_end, label, stats_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), slot.period, slot.start, slot.end, slot.label, JSON.stringify(stats), now).run();
    const enabled = slot.period === "week" ? flags.digest_weekly_sms === "1" : flags.digest_daily_sms === "1";
    if (!enabled) continue;
    const admins = await env.DB.prepare(
      "SELECT phone FROM users WHERE role = 'admin' AND status = 'active'"
    ).all<{ phone: string }>();
    const text = digestText(slot.period, stats);
    for (const admin of admins.results ?? []) await sendSms(env, admin.phone, text);
  }
}
