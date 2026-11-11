import { classifyStuck, isNewEpisode, stuckAlertSms, thresholdsFromSettings } from "./stuck-jobs.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

type JobRow = {
  id: string;
  trade: string;
  status: string;
  address: string | null;
  created_at: number;
  updated_at: number;
  assigned_tech_id: string | null;
  operator_flag: number;
  assigned_at: number | null;
  started_at: number | null;
};

type OpenAlert = { id: string; job_id: string; reason: string };

// Runs from the existing every-minute schedule. Texts stay off until an admin switches them on.
export async function checkStuckJobs(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const stored = await env.DB.prepare(
    `SELECT key, value FROM settings
     WHERE key IN ('stuck_awaiting_minutes', 'stuck_not_started_hours', 'stuck_in_progress_hours', 'stuck_alert_sms')`
  ).all<{ key: string; value: string }>();
  const values = Object.fromEntries((stored.results ?? []).map((row) => [row.key, row.value]));
  const thresholds = thresholdsFromSettings(values);
  let jobs: { results?: JobRow[] };
  let open: { results?: OpenAlert[] };
  try {
    jobs = await env.DB.prepare(
      `SELECT jobs.id, jobs.trade, jobs.status, jobs.address, jobs.created_at, jobs.updated_at,
              jobs.assigned_tech_id, jobs.operator_flag,
              (SELECT MIN(created_at) FROM job_events WHERE job_id = jobs.id AND type = 'assigned') AS assigned_at,
              (SELECT MIN(created_at) FROM job_events WHERE job_id = jobs.id AND type = 'en_route') AS started_at
       FROM jobs
       WHERE jobs.status IN ('new', 'offered', 'assigned', 'en_route', 'on_site')`
    ).all<JobRow>();
    open = await env.DB.prepare(
      "SELECT id, job_id, reason FROM job_alerts WHERE resolved_at IS NULL"
    ).all<OpenAlert>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      console.error("Stuck-job alerts skipped until migration 0008 is applied.");
      return;
    }
    throw error;
  }

  const openRows = (open.results ?? []).map((row) => ({ jobId: row.job_id, reason: row.reason, resolvedAt: null }));
  const still = new Set<string>();
  const fresh: { trade: string; area: string | null; reason: string; ageSeconds: number }[] = [];
  for (const job of jobs.results ?? []) {
    const hit = classifyStuck({
      status: job.status,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      assignedAt: job.assigned_at,
      startedAt: job.started_at,
      assignedTechId: job.assigned_tech_id,
      operatorFlag: job.operator_flag,
    }, thresholds, now);
    if (!hit) continue;
    still.add(`${job.id}:${hit.reason}`);
    if (!isNewEpisode(openRows, job.id, hit.reason)) continue;
    await env.DB.prepare(
      `INSERT INTO job_alerts (id, job_id, reason, anchor_at, opened_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), job.id, hit.reason, hit.anchorAt, now).run();
    fresh.push({ trade: job.trade, area: job.address, reason: hit.reason, ageSeconds: hit.ageSeconds });
  }
  for (const row of open.results ?? []) {
    if (still.has(`${row.job_id}:${row.reason}`)) continue;
    await env.DB.prepare("UPDATE job_alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").bind(now, row.id).run();
  }
  if (!fresh.length || !thresholds.sms) return;
  const text = stuckAlertSms(fresh);
  const staff = await env.DB.prepare(
    "SELECT phone FROM users WHERE role IN ('operator', 'admin') AND status = 'active'"
  ).all<{ phone: string }>();
  for (const person of staff.results ?? []) await sendSms(env, person.phone, text);
}
