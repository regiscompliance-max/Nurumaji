import { offerSlots, positionForDispatch, rankCandidates, shouldFlag, haversineKm } from "./dispatch.mjs";
import { preferOriginalTechnician } from "./followups.mjs";
import { rankingScore } from "./ratings.mjs";
import { postAfricaSms } from "./sms";
import type { Bindings } from "./types";

const MAX_OFFERS = 3;

type JobRow = {
  id: string;
  trade: string;
  urgency: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  assigned_tech_id: string | null;
  operator_flag: number;
};

type TechRow = {
  user_id: string;
  phone: string;
  name: string | null;
  trades: string;
  base_lat: number | null;
  base_lng: number | null;
  live_lat: number | null;
  live_lng: number | null;
  live_updated_at: number | null;
  radius_km: number | null;
  on_duty: number;
  approved: number;
  rating_avg: number;
  rating_count: number;
};

export async function dispatchJob(env: Bindings, jobId: string): Promise<void> {
  await offerNext(env, jobId);
}

export async function suggestTechnicians(env: Bindings, jobId: string) {
  const job = await env.DB.prepare(
    "SELECT id, trade, urgency, address, lat, lng, status, assigned_tech_id, operator_flag FROM jobs WHERE id = ?"
  ).bind(jobId).first<JobRow>();
  if (!job || job.lat == null || job.lng == null) return [];
  const excludeBusy = (await setting(env, "exclude_busy_technicians", "1")) !== "0";
  const ranked = await eligibleTechnicians(env, job, excludeBusy);
  return ranked.slice(0, 3).map((tech) => ({
    userId: tech.userId,
    name: tech.name || "Technician",
    distanceKm: Math.round(tech.distanceKm * 10) / 10,
  }));
}

export async function expireOffers(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = await env.DB.prepare(
    "SELECT id, job_id FROM job_offers WHERE status = 'offered' AND expires_at <= ?"
  ).bind(now).all<{ id: string; job_id: string }>();
  const rows = due.results ?? [];
  for (const row of rows) {
    await env.DB.prepare("UPDATE job_offers SET status = 'expired' WHERE id = ? AND status = 'offered'").bind(row.id).run();
    await env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, NULL, 'offer_expired', ?, ?)"
    ).bind(crypto.randomUUID(), row.job_id, "An offer expired", now).run();
  }
  const jobIds = [...new Set(rows.map((row) => row.job_id))];
  for (const jobId of jobIds) await offerNext(env, jobId);
}

async function offerNext(env: Bindings, jobId: string): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT id, trade, urgency, address, lat, lng, status, assigned_tech_id, operator_flag
     FROM jobs WHERE id = ?`
  ).bind(jobId).first<JobRow>();
  if (!job || job.assigned_tech_id || job.status === "cancelled" || job.status === "completed") return;
  if (job.lat == null || job.lng == null) {
    await flagJob(env, job, "No location was shared, so it could not be offered by distance.");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const timeout = Number(await setting(env, "offer_timeout_seconds", "600")) || 600;
  const excludeBusy = (await setting(env, "exclude_busy_technicians", "1")) !== "0";
  const counts = await env.DB.prepare(
    `SELECT
       COUNT(*) AS existing_offers,
       SUM(CASE WHEN status = 'offered' AND expires_at > ? THEN 1 ELSE 0 END) AS open_offers
     FROM job_offers WHERE job_id = ?`
  ).bind(now, job.id).first<{ existing_offers: number; open_offers: number | null }>();
  const existingOffers = counts?.existing_offers ?? 0;
  const openOffers = counts?.open_offers ?? 0;
  const slots = offerSlots({ urgency: job.urgency, existingOffers, openOffers, maxOffers: MAX_OFFERS });
  const ranked = await eligibleTechnicians(env, job, excludeBusy);
  const remaining = ranked.length;

  if (slots <= 0 || remaining === 0) {
    if (shouldFlag({ existingOffers, openOffers, remainingCandidates: remaining, maxOffers: MAX_OFFERS })) {
      await flagJob(env, job, existingOffers >= MAX_OFFERS
        ? "Three offers were made and none were accepted."
        : "No approved technician on duty is within range.");
    }
    return;
  }

  const chosen = ranked.slice(0, slots);
  for (const tech of chosen) {
    const offerId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO job_offers (id, job_id, tech_id, status, offered_at, expires_at)
       VALUES (?, ?, ?, 'offered', ?, ?)`
    ).bind(offerId, job.id, tech.userId, now, now + timeout).run();
    const article = job.trade === "electrical" ? "An" : "A";
    const message = `${article} ${job.trade} job is offered to you. Accept or decline it in the portal within ${Math.round(timeout / 60)} minutes.`;
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, message, read, created_at) VALUES (?, ?, ?, 0, ?)"
    ).bind(crypto.randomUUID(), tech.userId, message, now).run();
    await sendDispatchSms(env, tech.phone, message);
    await env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'offered', ?, ?)"
    ).bind(crypto.randomUUID(), job.id, tech.userId, "Offered to a technician", now).run();
  }
  await env.DB.prepare(
    "UPDATE jobs SET status = 'offered', operator_flag = 0, updated_at = ? WHERE id = ? AND assigned_tech_id IS NULL"
  ).bind(now, job.id).run();
}

async function eligibleTechnicians(env: Bindings, job: JobRow, excludeBusy: boolean) {
  const techs = await env.DB.prepare(
    `SELECT users.id AS user_id, users.phone, users.name, technician_profiles.trades, technician_profiles.base_lat,
            technician_profiles.base_lng, technician_profiles.live_lat, technician_profiles.live_lng,
            technician_profiles.live_updated_at, technician_profiles.radius_km, technician_profiles.on_duty,
            technician_profiles.approved, technician_profiles.rating_avg, technician_profiles.rating_count
     FROM technician_profiles
     JOIN users ON users.id = technician_profiles.user_id
     WHERE users.role = 'technician' AND users.status = 'active'
       AND technician_profiles.approved = 1 AND technician_profiles.on_duty = 1`
  ).all<TechRow>();
  const already = await env.DB.prepare(
    "SELECT tech_id FROM job_offers WHERE job_id = ?"
  ).bind(job.id).all<{ tech_id: string }>();
  const seen = new Set((already.results ?? []).map((row) => row.tech_id));
  const busy = new Set<string>();
  if (excludeBusy) {
    const active = await env.DB.prepare(
      `SELECT assigned_tech_id FROM jobs
       WHERE assigned_tech_id IS NOT NULL AND status IN ('assigned', 'en_route', 'on_site')`
    ).all<{ assigned_tech_id: string }>();
    for (const row of active.results ?? []) busy.add(row.assigned_tech_id);
  }
  const candidates = [];
  for (const tech of techs.results ?? []) {
    if (seen.has(tech.user_id) || busy.has(tech.user_id)) continue;
    if (!hasTrade(tech.trades, job.trade)) continue;
    const spot = positionForDispatch({
      baseLat: tech.base_lat,
      baseLng: tech.base_lng,
      liveLat: tech.live_lat,
      liveLng: tech.live_lng,
      liveUpdatedAt: tech.live_updated_at,
      now: Math.floor(Date.now() / 1000),
    });
    if (!spot || tech.radius_km == null) continue;
    const distanceKm = haversineKm(job.lat as number, job.lng as number, spot.lat, spot.lng);
    if (distanceKm > tech.radius_km) continue;
    if (await probationBlocks(env, tech.user_id, job.urgency)) continue;
    candidates.push({ userId: tech.user_id, name: tech.name, phone: tech.phone, distanceKm, ratingAvg: rankingScore(tech.rating_avg, tech.rating_count) });
  }
  const ranked = rankCandidates(candidates);
  return preferOriginalTechnician(ranked, await originalTechnicianId(env, job.id));
}

async function originalTechnicianId(env: Bindings, returnJobId: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT jobs.assigned_tech_id AS tech_id
       FROM job_followups
       JOIN jobs ON jobs.id = job_followups.original_job_id
       WHERE job_followups.return_job_id = ?`
    ).bind(returnJobId).first<{ tech_id: string | null }>();
    return row?.tech_id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return null;
    throw error;
  }
}

async function probationBlocks(env: Bindings, userId: string, urgency: string): Promise<boolean> {
  if (urgency === "standard") return false;
  const probation = await env.DB.prepare(
    "SELECT id FROM technician_applications WHERE user_id = ? AND status = 'probation' LIMIT 1"
  ).bind(userId).first();
  if (!probation) return false;
  const requiredText = await setting(env, "probation_completed_jobs", "");
  const required = Number(requiredText);
  if (!Number.isInteger(required) || required <= 0) return true;
  const done = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM jobs WHERE assigned_tech_id = ? AND status IN ('completed', 'invoiced', 'paid')"
  ).bind(userId).first<{ n: number }>();
  return (done?.n ?? 0) < required;
}

function hasTrade(trades: string, trade: string): boolean {
  return trades.split(",").map((item) => item.trim()).includes(trade);
}

async function flagJob(env: Bindings, job: JobRow, note: string): Promise<void> {
  if (job.operator_flag === 1) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE jobs SET operator_flag = 1, updated_at = ? WHERE id = ?").bind(now, job.id).run();
  await env.DB.prepare(
    "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, NULL, 'needs_operator', ?, ?)"
  ).bind(crypto.randomUUID(), job.id, note, now).run();
}

async function setting(env: Bindings, key: string, fallback: string): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value || fallback;
  } catch {
    return fallback;
  }
}

async function sendDispatchSms(env: Bindings, phone: string, message: string): Promise<void> {
  if (env.OTP_DEV_MODE === "true") {
    console.log(`[DISPATCH_SMS] ${phone} ${message}`);
    return;
  }
  if (!env.AT_API_KEY || !env.AT_USERNAME) {
    console.error("Dispatch SMS was not sent because Africa's Talking is not configured.");
    return;
  }
  const response = await postAfricaSms(env, phone, `Nuru & Maji: ${message}`);
  if (!response.ok) console.error("Dispatch SMS failed.");
}

export async function acceptOffer(env: Bindings, offerId: string, techId: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const offer = await env.DB.prepare(
    `SELECT id, job_id FROM job_offers
     WHERE id = ? AND tech_id = ? AND status = 'offered' AND expires_at > ?`
  ).bind(offerId, techId, now).first<{ id: string; job_id: string }>();
  if (!offer) return "That offer is no longer open.";
  const claimed = await env.DB.prepare(
    `UPDATE jobs SET status = 'assigned', assigned_tech_id = ?, operator_flag = 0, updated_at = ?
     WHERE id = ? AND status = 'offered' AND assigned_tech_id IS NULL`
  ).bind(techId, now, offer.job_id).run();
  if (!claimed.meta.changes) return "Another technician already accepted.";
  await env.DB.batch([
    env.DB.prepare("UPDATE job_offers SET status = 'accepted' WHERE id = ?").bind(offer.id),
    env.DB.prepare(
      "UPDATE job_offers SET status = 'declined' WHERE job_id = ? AND status = 'offered' AND id != ?"
    ).bind(offer.job_id, offer.id),
    env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'assigned', ?, ?)"
    ).bind(crypto.randomUUID(), offer.job_id, techId, "A technician accepted", now),
  ]);
  return null;
}

export async function declineOffer(env: Bindings, offerId: string, techId: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const offer = await env.DB.prepare(
    "SELECT id, job_id FROM job_offers WHERE id = ? AND tech_id = ? AND status = 'offered'"
  ).bind(offerId, techId).first<{ id: string; job_id: string }>();
  if (!offer) return "That offer is no longer open.";
  await env.DB.prepare("UPDATE job_offers SET status = 'declined' WHERE id = ?").bind(offer.id).run();
  await env.DB.prepare(
    "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'offer_declined', ?, ?)"
  ).bind(crypto.randomUUID(), offer.job_id, techId, "A technician declined", now).run();
  await offerNext(env, offer.job_id);
  return null;
}
