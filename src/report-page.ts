import { loadReport, type ReportStats } from "./report-run";
import { formatDuration, reportWindow } from "./reports.mjs";
import type { Bindings } from "./types";

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["days7", "Last 7 days"],
  ["days30", "Last 30 days"],
] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function money(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE")}`;
}

function methodLabel(method: string): string {
  if (method === "mpesa") return "M-Pesa";
  if (method === "cash") return "Cash";
  if (method === "bank") return "Bank";
  if (!method) return "Not recorded";
  return method;
}

function duration(seconds: number | null): string {
  return formatDuration(seconds) ?? "no data";
}

export function reportMarkup(stats: ReportStats, label: string): string {
  const collected = stats.collected.length
    ? stats.collected.map((row) => `<li>${escapeHtml(methodLabel(row.method))} ${money(row.amountKes)}</li>`).join("")
    : "<li>No payments recorded.</li>";
  const technicians = stats.technicians.length
    ? stats.technicians.map((row) => `<li>${escapeHtml(row.name)} · ${row.completed} completed · rating ${row.rating == null ? "no data" : row.rating}</li>`).join("")
    : "<li>No completed jobs in this period.</li>";
  const stat = (title: string, value: string) => `<article class="stat"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong></article>`;
  return `<p class="muted">${escapeHtml(label)}, Africa/Nairobi. Empty figures are zero or no data.</p>
    <div class="report-grid">
      ${stat("Jobs booked", String(stats.booked))}
      ${stat("Jobs completed", String(stats.completed))}
      ${stat("Jobs cancelled", String(stats.cancelled))}
      ${stat("Still open", String(stats.open))}
      ${stat("Stuck alerts open", String(stats.stuckOpen))}
      ${stat("Test sheets passed", String(stats.sheetsPassed))}
      ${stat("Test sheets failed", String(stats.sheetsFailed))}
      ${stat("Invoices issued", `${stats.invoicesIssued} · ${money(stats.invoicesIssuedKes)}`)}
      ${stat("Cash collected", money(stats.collectedTotal))}
      ${stat("Money owed", money(stats.owedKes))}
      ${stat("Overdue", money(stats.overdueKes))}
      ${stat("Quotes sent", String(stats.quotesSent))}
      ${stat("Quotes accepted", String(stats.quotesAccepted))}
      ${stat("New applications", String(stats.applications))}
      ${stat("Booking to assigned", duration(stats.bookingToAssignedSeconds))}
      ${stat("Assigned to completed", duration(stats.assignedToCompletedSeconds))}
    </div>
    <h2>Collected by method</h2>
    <ul>${collected}</ul>
    <h2>Technicians</h2>
    <ul>${technicians}</ul>`;
}

export async function reportsInner(env: Bindings, range: string, snapshotId: string): Promise<string> {
  const chosen = RANGES.some(([key]) => key === range) ? range : "today";
  const nav = `<nav class="report-nav" aria-label="Report period">${RANGES.map(([key, name]) =>
    `<a class="btn ${key === chosen && !snapshotId ? "btn-amber" : "btn-line-ink"}" href="/portal/admin/reports?range=${key}">${name}</a>`
  ).join("")}</nav>`;
  let body = "";
  if (snapshotId) {
    try {
      const row = await env.DB.prepare(
        "SELECT label, period, stats_json FROM report_snapshots WHERE id = ?"
      ).bind(snapshotId).first<{ label: string; period: string; stats_json: string }>();
      if (!row) body = `<p>That saved digest was not found.</p>`;
      else body = reportMarkup(JSON.parse(row.stats_json) as ReportStats, `Saved ${row.period} · ${row.label}`);
    } catch {
      body = `<p class="muted">Saved digests appear after the latest migration is applied.</p>`;
    }
  } else {
    const window = reportWindow(chosen, Math.floor(Date.now() / 1000));
    const stats = await loadReport(env, window.start, window.end);
    body = reportMarkup(stats, window.label);
  }
  let history = `<p class="muted">No digest has been saved yet.</p>`;
  try {
    const rows = await env.DB.prepare(
      "SELECT id, period, label, created_at FROM report_snapshots ORDER BY period_start DESC LIMIT 30"
    ).all<{ id: string; period: string; label: string; created_at: number }>();
    if ((rows.results ?? []).length) {
      history = `<ul>${(rows.results ?? []).map((row) =>
        `<li><a href="/portal/admin/reports?snapshot=${row.id}">${escapeHtml(row.period)} · ${escapeHtml(row.label)}</a></li>`
      ).join("")}</ul>`;
    }
  } catch {
    history = `<p class="muted">Saved digests appear after the latest migration is applied.</p>`;
  }
  return `${nav}<section class="report-sheet doc-block" id="report">${body}</section><h2>Saved digests</h2>${history}`;
}
