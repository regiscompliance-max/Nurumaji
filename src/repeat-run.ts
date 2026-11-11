import { followUpKind, followUpText, isDue, shouldTextClient } from "./repeat.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

export async function repeatFollowUps(env: Bindings): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const last = await env.DB.prepare("SELECT value FROM settings WHERE key = 'repeat_followup_on'").first<{ value: string }>();
  if (last?.value === today) return;
  const settings = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('repeat_electrical_months', 'repeat_heater_months', 'repeat_sms')"
  ).all<{ key: string; value: string }>();
  const values = Object.fromEntries((settings.results ?? []).map((row) => [row.key, row.value]));
  const electricalMonths = positiveMonths(values.repeat_electrical_months, 12);
  const heaterMonths = positiveMonths(values.repeat_heater_months, 12);
  const smsOn = values.repeat_sms === "1";
  let jobs: { results?: { id: string; client_id: string; trade: string; description: string; phone: string; opted_out: number; completed_at: number }[] };
  try {
    jobs = await env.DB.prepare(
      `SELECT jobs.id, jobs.client_id, jobs.trade, jobs.description, users.phone, users.followup_opt_out AS opted_out,
              MIN(job_events.created_at) AS completed_at
       FROM jobs
       JOIN users ON users.id = jobs.client_id
       JOIN job_events ON job_events.job_id = jobs.id AND job_events.type = 'completed'
       WHERE jobs.status IN ('completed', 'invoiced', 'paid')
       GROUP BY jobs.id`
    ).all<{ id: string; client_id: string; trade: string; description: string; phone: string; opted_out: number; completed_at: number }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such column") || message.includes("no such table")) return;
    throw error;
  }
  const now = Math.floor(Date.now() / 1000);
  for (const job of jobs.results ?? []) {
    const kind = followUpKind(job.trade, job.description);
    if (!kind) continue;
    const completedOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(job.completed_at * 1000));
    const months = kind === "water_heater" ? heaterMonths : electricalMonths;
    if (!isDue(completedOn, today, months)) continue;
    const existing = await env.DB.prepare(
      "SELECT id FROM followup_reminders WHERE job_id = ? AND kind = ?"
    ).bind(job.id, kind).first();
    if (existing) continue;
    await env.DB.prepare(
      `INSERT INTO followup_reminders (id, job_id, client_id, kind, due_on, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'due', ?)`
    ).bind(crypto.randomUUID(), job.id, job.client_id, kind, today, now).run();
    if (!shouldTextClient(smsOn, job.opted_out === 1)) continue;
    await sendSms(env, job.phone, followUpText(kind));
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('repeat_followup_on', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(today).run();
}

function positiveMonths(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 36 ? parsed : fallback;
}
