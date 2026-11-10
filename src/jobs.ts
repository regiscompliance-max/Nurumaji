import { Hono } from "hono";
import { z } from "zod";
import { nowSeconds } from "./crypto";
import { dispatchJob } from "./dispatch-run";
import { readSession } from "./session";
import { lookupService } from "./services.mjs";
import type { AppContext, UserRow } from "./types";

const HOUR = 60 * 60;
const MAX_JOBS_PER_USER = 8;
const MAX_JOBS_PER_IP = 20;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const tradeSchema = z.enum(["electrical", "plumbing"]);
const urgencySchema = z.enum(["standard", "urgent", "emergency"]);

type JobRow = {
  id: string;
  client_id: string;
  trade: "electrical" | "plumbing";
  description: string;
  urgency: "standard" | "urgent" | "emergency";
  address: string | null;
  lat: number | null;
  lng: number | null;
  preferred_time: number | null;
  status: string;
  assigned_tech_id?: string | null;
  created_at: number;
  updated_at: number;
};

type EventRow = { id: string; type: string; note: string | null; created_at: number };
type PhotoRow = { id: string; created_at: number };
type QuoteRow = { id: string; amount_kes: number; status: string; created_at: number };
type RatingRow = { score: number; comment: string | null };

export const jobs = new Hono<AppContext>({ strict: false });

jobs.post("/", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const limited = await overLimit(c, user.id, ip);
  if (limited) return c.json({ error: "Too many booking requests. Try again in an hour." }, 429);

  const input = await readJobInput(c);
  if (!input.ok) return c.json({ error: input.error }, 400);

  const now = nowSeconds();
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO jobs (id, client_id, trade, description, urgency, address, lat, lng, preferred_time, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
    ).bind(id, user.id, input.trade, input.description, input.urgency, input.address, input.lat, input.lng, input.preferredTime, now, now),
    c.env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'created', ?, ?)"
    ).bind(crypto.randomUUID(), id, user.id, "Request received", now),
    c.env.DB.prepare("INSERT INTO booking_limits (id, bucket, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), `user:${user.id}`, now),
    c.env.DB.prepare("INSERT INTO booking_limits (id, bucket, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), `ip:${ip}`, now),
  ]);

  if (input.files.length) {
    if (!c.env.UPLOADS) return c.json({ error: "Photo storage is not connected yet. The request was saved without photos.", id, path: `/portal/jobs/${id}` }, 201);
    for (const file of input.files) {
      const photoId = crypto.randomUUID();
      await c.env.UPLOADS.put(`jobs/${id}/${photoId}`, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });
      await c.env.DB.prepare(
        "INSERT INTO job_photos (id, job_id, r2_key, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(photoId, id, `jobs/${id}/${photoId}`, user.id, now).run();
    }
  }

  try {
    await dispatchJob(c.env, id);
  } catch (error) {
    console.error(error);
  }
  return c.json({ id, path: `/portal/jobs/${id}`, appUrl: appUrl(c) }, 201);
});

jobs.get("/", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const rows = await c.env.DB.prepare(
    `SELECT id, trade, description, urgency, status, created_at FROM jobs
     WHERE client_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  return c.json({ jobs: rows.results ?? [] });
});

jobs.get("/:id", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const job = await ownJob(c, user, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  const detail = await jobDetail(c, job.id);
  return c.json({ job, ...detail });
});

jobs.get("/:id/photos/:photoId", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const job = await viewableJob(c, user, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (!c.env.UPLOADS) return c.json({ error: "Photo storage is not connected yet." }, 503);
  const photo = await c.env.DB.prepare(
    "SELECT id, r2_key FROM job_photos WHERE id = ? AND job_id = ?"
  ).bind(c.req.param("photoId"), job.id).first<{ id: string; r2_key: string }>();
  if (!photo) return c.json({ error: "Photo not found." }, 404);
  const object = await c.env.UPLOADS.get(photo.r2_key);
  if (!object) return c.json({ error: "Photo not found." }, 404);
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});

jobs.post("/:id/quotes/:quoteId/approve", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const job = await ownJob(c, user, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  const now = nowSeconds();
  const result = await c.env.DB.prepare(
    "UPDATE quotes SET status = 'approved' WHERE id = ? AND job_id = ? AND status = 'sent'"
  ).bind(c.req.param("quoteId"), job.id).run();
  if (!result.meta.changes) return c.json({ error: "That quote cannot be approved." }, 400);
  await c.env.DB.prepare(
    "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'quote_approved', ?, ?)"
  ).bind(crypto.randomUUID(), job.id, user.id, "Quote approved", now).run();
  if (wantsHtml(c)) return c.redirect(`/portal/jobs/${job.id}`, 303);
  return c.json({ ok: true });
});

jobs.post("/:id/rating", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const job = await ownJob(c, user, c.req.param("id"));
  if (!job) return c.json({ error: "Job not found." }, 404);
  if (job.status !== "completed") return c.json({ error: "You can rate the job after the work is completed." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM ratings WHERE job_id = ?").bind(job.id).first();
  if (existing) return c.json({ error: "This job already has a rating." }, 400);
  const parsed = z.object({
    score: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(500).optional(),
  }).safeParse(await readBody(c));
  if (!parsed.success) return c.json({ error: "Choose a rating from 1 to 5." }, 400);
  const now = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO ratings (id, job_id, client_id, tech_id, score, comment) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), job.id, user.id, job.assigned_tech_id || user.id, parsed.data.score, parsed.data.comment || null),
    c.env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'rated', ?, ?)"
    ).bind(crypto.randomUUID(), job.id, user.id, `Rated ${parsed.data.score} out of 5`, now),
  ]);
  if (wantsHtml(c)) return c.redirect(`/portal/jobs/${job.id}`, 303);
  return c.json({ ok: true });
});

function appUrl(c: { env: AppContext["Bindings"]; req: { url: string } }): string {
  const configured = c.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return new URL(c.req.url).origin;
}

async function viewableJob(c: { env: AppContext["Bindings"] }, user: UserRow, id: string): Promise<{ id: string } | null> {
  const job = await c.env.DB.prepare(
    "SELECT id, client_id, assigned_tech_id FROM jobs WHERE id = ?"
  ).bind(id).first<{ id: string; client_id: string; assigned_tech_id: string | null }>();
  if (!job) return null;
  if (job.client_id === user.id) return job;
  if (user.role !== "technician") return null;
  if (job.assigned_tech_id === user.id) return job;
  const offer = await c.env.DB.prepare(
    "SELECT id FROM job_offers WHERE job_id = ? AND tech_id = ?"
  ).bind(id, user.id).first();
  return offer ? job : null;
}

async function ownJob(c: { env: AppContext["Bindings"] }, user: UserRow, id: string): Promise<JobRow | null> {
  return c.env.DB.prepare(
    `SELECT id, client_id, trade, description, urgency, address, lat, lng, preferred_time, status, assigned_tech_id, created_at, updated_at
     FROM jobs WHERE id = ? AND client_id = ?`
  ).bind(id, user.id).first<JobRow>();
}

async function jobDetail(c: { env: AppContext["Bindings"] }, jobId: string) {
  const [events, photos, quotes, rating] = await Promise.all([
    c.env.DB.prepare("SELECT id, type, note, created_at FROM job_events WHERE job_id = ? ORDER BY created_at ASC").bind(jobId).all<EventRow>(),
    c.env.DB.prepare("SELECT id, created_at FROM job_photos WHERE job_id = ? ORDER BY created_at ASC").bind(jobId).all<PhotoRow>(),
    c.env.DB.prepare("SELECT id, amount_kes, status, created_at FROM quotes WHERE job_id = ? ORDER BY created_at ASC").bind(jobId).all<QuoteRow>(),
    c.env.DB.prepare("SELECT score, comment FROM ratings WHERE job_id = ?").bind(jobId).first<RatingRow>(),
  ]);
  return {
    events: events.results ?? [],
    photos: photos.results ?? [],
    quotes: quotes.results ?? [],
    invoices: (await c.env.DB.prepare("SELECT id, amount_kes, status, paid_at FROM invoices WHERE job_id = ? ORDER BY rowid").bind(jobId).all<{ id: string; amount_kes: number; status: string; paid_at: number | null }>()).results ?? [],
    rating: rating ?? null,
  };
}

export async function loadClientJobs(c: { env: AppContext["Bindings"] }, userId: string) {
  const listed = await c.env.DB.prepare(
    `SELECT jobs.id, jobs.trade, jobs.description, jobs.urgency, jobs.status, jobs.address,
            jobs.preferred_time, jobs.created_at, jobs.assigned_tech_id,
            tech.name AS tech_name,
            CASE WHEN technician_profiles.photo_key IS NOT NULL AND technician_profiles.photo_key != '' THEN 1 ELSE 0 END AS tech_has_photo
     FROM jobs
     LEFT JOIN users AS tech ON tech.id = jobs.assigned_tech_id
     LEFT JOIN technician_profiles ON technician_profiles.user_id = jobs.assigned_tech_id
     WHERE jobs.client_id = ? ORDER BY jobs.created_at DESC`
  ).bind(userId).all<JobRow & { assigned_tech_id: string | null; tech_name: string | null; tech_has_photo: number }>();
  const jobs = listed.results ?? [];
  const detailed = [];
  for (const job of jobs) {
    const detail = await jobDetail(c, job.id);
    detailed.push({ job, ...detail });
  }
  return detailed;
}

async function overLimit(c: { env: AppContext["Bindings"] }, userId: string, ip: string): Promise<boolean> {
  const since = nowSeconds() - HOUR;
  const userCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM booking_limits WHERE bucket = ? AND created_at > ?"
  ).bind(`user:${userId}`, since).first<{ n: number }>();
  const ipCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM booking_limits WHERE bucket = ? AND created_at > ?"
  ).bind(`ip:${ip}`, since).first<{ n: number }>();
  return (userCount?.n ?? 0) >= MAX_JOBS_PER_USER || (ipCount?.n ?? 0) >= MAX_JOBS_PER_IP;
}

async function readJobInput(c: { req: { header: (name: string) => string | undefined; json: () => Promise<unknown>; formData: () => Promise<FormData> } }): Promise<
  | { ok: true; trade: "electrical" | "plumbing"; description: string; urgency: "standard" | "urgent" | "emergency"; address: string | null; lat: number | null; lng: number | null; preferredTime: number | null; files: File[] }
  | { ok: false; error: string }
> {
  const contentType = c.req.header("content-type") || "";
  let raw: Record<string, unknown> = {};
  const files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        if (key === "photos" && value.size > 0) files.push(value);
      } else {
        raw[key] = value;
      }
    }
  } else {
    const body = await readJson(c);
    if (body && typeof body === "object") raw = body as Record<string, unknown>;
  }

  const service = lookupService(raw.service);
  const tradeParsed = tradeSchema.safeParse(raw.trade ?? service?.trade);
  if (!tradeParsed.success) return { ok: false, error: "Choose electrical or plumbing." };
  const urgencyParsed = urgencySchema.safeParse(raw.urgency || "standard");
  if (!urgencyParsed.success) return { ok: false, error: "Choose how urgent the job is." };

  let description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (service && description && !description.startsWith(service.label)) description = `${service.label}. ${description}`;
  if (service && !description) description = service.label;
  if (description.length < 8 || description.length > 2000) return { ok: false, error: "Describe the problem in a few words." };

  const address = typeof raw.address === "string" ? raw.address.trim() : "";
  const portalForm = raw.channel === "portal";
  if (portalForm && address.length < 5) return { ok: false, error: "Enter the address or area for the visit." };
  if (address.length > 300) return { ok: false, error: "The address is too long." };

  const lat = parseCoord(raw.lat, -90, 90);
  const lng = parseCoord(raw.lng, -180, 180);
  if (raw.lat && lat == null || raw.lng && lng == null) return { ok: false, error: "The location could not be read. Enter the address instead." };

  if (files.length > MAX_PHOTOS) return { ok: false, error: "Attach up to 4 photos." };
  for (const file of files) {
    if (!PHOTO_TYPES.has(file.type) || file.size > MAX_PHOTO_BYTES) {
      return { ok: false, error: "Photos must be JPG, PNG or WebP, and under 5 MB each." };
    }
  }

  return {
    ok: true,
    trade: tradeParsed.data,
    description,
    urgency: urgencyParsed.success ? urgencyParsed.data : "standard",
    address: address || null,
    lat,
    lng,
    preferredTime: parsePreferred(raw.preferredTime ?? raw.preferred_time),
    files,
  };
}

function parseCoord(value: unknown, min: number, max: number): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function parsePreferred(value: unknown): number | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) {
    const number = Number(text);
    return text.length >= 13 ? Math.floor(number / 1000) : number;
  }
  const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && !/[zZ+\-]\d{2}:?\d{2}$/.test(text) && !text.endsWith("Z")
    ? `${text.length === 16 ? text : text.slice(0, 16)}+03:00`
    : text;
  const ms = Date.parse(withZone);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function wantsHtml(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return !c.req.header("accept")?.includes("application/json");
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

async function readBody(c: { req: { header: (name: string) => string | undefined; json: () => Promise<unknown>; formData: () => Promise<FormData> } }): Promise<unknown> {
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) return readJson(c);
  const form = await c.req.formData();
  const raw: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") raw[key] = value;
  return raw;
}
