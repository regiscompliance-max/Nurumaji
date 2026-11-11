import { nowSeconds, randomToken, sha256 } from "./crypto";
import { canEditRating, isLowRating, RATING_LINK_SECONDS, ratingInviteDue } from "./ratings.mjs";
import { nairobiParts } from "./payments.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

const DONE = new Set(["completed", "invoiced", "paid"]);

type SaveInput = {
  jobId: string;
  clientId: string;
  score: number;
  comment: string;
  now: number;
};

export async function saveJobRating(env: Bindings, input: SaveInput): Promise<{ error?: string; ok?: boolean }> {
  const job = await env.DB.prepare(
    "SELECT id, status, client_id, assigned_tech_id FROM jobs WHERE id = ?"
  ).bind(input.jobId).first<{ id: string; status: string; client_id: string; assigned_tech_id: string | null }>();
  if (!job || job.client_id !== input.clientId) return { error: "Job not found." };
  if (!DONE.has(job.status)) return { error: "You can rate the job after the work is completed." };
  if (!job.assigned_tech_id) return { error: "This job does not have a technician yet." };
  const score = input.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: "Choose a rating from 1 to 5." };
  const comment = input.comment.trim().slice(0, 500);
  const existing = await env.DB.prepare(
    "SELECT id, created_at FROM ratings WHERE job_id = ?"
  ).bind(job.id).first<{ id: string; created_at: number | null }>();
  if (existing && !canEditRating(existing.created_at, input.now)) return { error: "This rating can no longer be changed." };
  if (existing) {
    await env.DB.prepare(
      "UPDATE ratings SET score = ?, comment = ?, updated_at = ? WHERE id = ?"
    ).bind(score, comment || null, input.now, existing.id).run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, 'rating_updated', ?, ?)"
    ).bind(crypto.randomUUID(), input.clientId, JSON.stringify({ jobId: job.id, score }), input.now).run();
  } else {
    const ratingId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO ratings (id, job_id, client_id, tech_id, score, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(ratingId, job.id, input.clientId, job.assigned_tech_id, score, comment || null, input.now, input.now),
      env.DB.prepare(
        "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'rated', ?, ?)"
      ).bind(crypto.randomUUID(), job.id, input.clientId, `Rated ${score} out of 5`, input.now),
      env.DB.prepare(
        "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, 'rating_saved', ?, ?)"
      ).bind(crypto.randomUUID(), input.clientId, JSON.stringify({ jobId: job.id, score }), input.now),
    ]);
  }
  await refreshTechnicianRating(env, job.assigned_tech_id);
  if (isLowRating(score)) await ensureLowRatingAlert(env, job.id, score, input.now);
  return { ok: true };
}

async function refreshTechnicianRating(env: Bindings, techId: string): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n, AVG(score) AS avg FROM ratings WHERE tech_id = ?"
  ).bind(techId).first<{ n: number; avg: number | null }>();
  const count = Number(row?.n ?? 0) || 0;
  const avg = count > 0 && row?.avg != null ? Number(row.avg) : 0;
  await env.DB.prepare(
    "UPDATE technician_profiles SET rating_avg = ?, rating_count = ? WHERE user_id = ?"
  ).bind(avg, count, techId).run();
}

async function ensureLowRatingAlert(env: Bindings, jobId: string, score: number, now: number): Promise<void> {
  const rating = await env.DB.prepare("SELECT id FROM ratings WHERE job_id = ?").bind(jobId).first<{ id: string }>();
  if (!rating) return;
  const existing = await env.DB.prepare("SELECT id FROM rating_alerts WHERE rating_id = ?").bind(rating.id).first();
  if (existing) {
    await env.DB.prepare("UPDATE rating_alerts SET score = ? WHERE rating_id = ?").bind(score, rating.id).run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO rating_alerts (id, rating_id, job_id, score, opened_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), rating.id, jobId, score, now).run();
}

export async function checkRatingInvites(env: Bindings): Promise<void> {
  const now = nowSeconds();
  const hour = nairobiParts(now).hour;
  const stored = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('rating_sms', 'rating_sms_delay_hours')"
  ).all<{ key: string; value: string }>();
  const values = Object.fromEntries((stored.results ?? []).map((row) => [row.key, row.value]));
  if (values.rating_sms !== "1") return;
  const delay = Number(values.rating_sms_delay_hours);
  const delayHours = Number.isInteger(delay) && delay >= 1 && delay <= 72 ? delay : 2;
  const origin = env.APP_URL?.trim().replace(/\/$/, "");
  if (!origin) {
    console.error("Rating texts skipped because APP_URL is not set.");
    return;
  }
  let jobs: { results?: { id: string; phone: string; completed_at: number | null; rated: number; invited: number }[] };
  try {
    jobs = await env.DB.prepare(
      `SELECT jobs.id, users.phone,
              (SELECT MIN(created_at) FROM job_events WHERE job_id = jobs.id AND type = 'completed') AS completed_at,
              (SELECT COUNT(*) FROM ratings WHERE job_id = jobs.id) AS rated,
              (SELECT COUNT(*) FROM rating_invites WHERE job_id = jobs.id) AS invited
       FROM jobs
       JOIN users ON users.id = jobs.client_id
       WHERE jobs.status IN ('completed', 'invoiced', 'paid') AND jobs.assigned_tech_id IS NOT NULL`
    ).all<{ id: string; phone: string; completed_at: number | null; rated: number; invited: number }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("no such column")) {
      console.error("Rating texts skipped until migration 0012 is applied.");
      return;
    }
    throw error;
  }
  for (const job of jobs.results ?? []) {
    if (!ratingInviteDue({
      completedAt: job.completed_at,
      now,
      delayHours,
      hour,
      alreadySent: job.invited > 0,
      alreadyRated: job.rated > 0,
    })) continue;
    const token = randomToken();
    const url = `${origin}/rate/${token}`;
    await sendSms(env, job.phone, `Nuru & Maji: how was the visit? Rate it here: ${url} The link works for 14 days.`);
    await env.DB.prepare(
      "INSERT INTO rating_invites (id, job_id, token_hash, expires_at, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), job.id, await sha256(token), now + RATING_LINK_SECONDS, now, now).run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, NULL, 'rating_sms_sent', ?, ?)"
    ).bind(crypto.randomUUID(), JSON.stringify({ jobId: job.id }), now).run();
  }
}
