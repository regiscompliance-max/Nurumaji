import { Hono } from "hono";
import { z } from "zod";
import { nowSeconds } from "./crypto";
import { acceptOffer, declineOffer } from "./dispatch-run";
import { storeTechnicianPhoto } from "./portrait";
import { readSession } from "./session";
import { validateTestSheet } from "./test-sheet.mjs";
import type { AppContext } from "./types";

const tradesSchema = z.array(z.enum(["electrical", "plumbing"])).min(1);
const profileSchema = z.object({
  trades: tradesSchema,
  baseLat: z.coerce.number().gte(-90).lte(90),
  baseLng: z.coerce.number().gte(-180).lte(180),
  radiusKm: z.coerce.number().gt(0).lte(100),
});
const dutySchema = z.object({ onDuty: z.union([z.boolean(), z.literal("0"), z.literal("1"), z.literal("true"), z.literal("false")]) });
const progressSchema = z.object({
  status: z.enum(["en_route", "on_site", "completed"]),
  note: z.string().trim().max(500).optional(),
  materials: z.string().trim().max(500).optional(),
  minutesSpent: z.preprocess(
    (value) => value === "" || value == null ? undefined : value,
    z.coerce.number().int().positive().max(24 * 60).optional(),
  ),
});

const NEXT: Record<string, string> = {
  assigned: "en_route",
  en_route: "on_site",
  on_site: "completed",
};

export const technician = new Hono<AppContext>({ strict: false });

technician.use("*", async (c, next) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  c.set("user", user);
  await next();
});

technician.get("/profile", async (c) => {
  const user = c.get("user");
  const profile = await c.env.DB.prepare(
    "SELECT trades, base_lat, base_lng, radius_km, on_duty, approved, rating_avg, rating_count FROM technician_profiles WHERE user_id = ?"
  ).bind(user.id).first();
  return c.json({ profile: profile ?? null });
});

technician.post("/photo", async (c) => {
  const user = c.get("user");
  let file: File | null = null;
  try {
    const form = await c.req.formData();
    const value = form.get("photo");
    if (value instanceof File && value.size > 0) file = value;
  } catch {
    file = null;
  }
  if (!file) return c.json({ error: "Choose a photo." }, 400);
  const stored = await storeTechnicianPhoto(c.env, user.id, file);
  if (typeof stored !== "string") return c.json({ error: stored.error }, 400);
  if (wantsHtml(c)) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true });
});

technician.post("/profile", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const raw = await readBody(c);
  const trades = normalizeTrades(raw.trades ?? raw["trades"]);
  const parsed = profileSchema.safeParse({ ...raw, trades });
  if (!parsed.success) return c.json({ error: "Enter your trades, base location, and a radius up to 100 km." }, 400);
  const value = parsed.data.trades.join(",");
  await c.env.DB.prepare(
    `INSERT INTO technician_profiles (user_id, trades, base_lat, base_lng, radius_km, on_duty, approved, rating_avg, rating_count)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0)
     ON CONFLICT(user_id) DO UPDATE SET
       trades = excluded.trades,
       base_lat = excluded.base_lat,
       base_lng = excluded.base_lng,
       radius_km = excluded.radius_km`
  ).bind(user.id, value, parsed.data.baseLat, parsed.data.baseLng, parsed.data.radiusKm).run();
  if (wantsHtml(c)) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true });
});

technician.post("/duty", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const raw = await readBody(c);
  const parsed = dutySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Choose on duty or off duty." }, 400);
  const onDuty = parsed.data.onDuty === true || parsed.data.onDuty === "1" || parsed.data.onDuty === "true";
  const profile = await c.env.DB.prepare(
    "SELECT user_id, base_lat, radius_km FROM technician_profiles WHERE user_id = ?"
  ).bind(user.id).first<{ user_id: string; base_lat: number | null; radius_km: number | null }>();
  if (!profile || profile.base_lat == null || profile.radius_km == null) {
    return c.json({ error: "Save a base location and radius before going on duty." }, 400);
  }
  await c.env.DB.prepare("UPDATE technician_profiles SET on_duty = ? WHERE user_id = ?").bind(onDuty ? 1 : 0, user.id).run();
  if (!onDuty) await clearLivePosition(c.env, user.id);
  if (wantsHtml(c)) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true, onDuty });
});

technician.post("/offers/:id/accept", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const error = await acceptOffer(c.env, c.req.param("id"), user.id);
  if (error) return c.json({ error }, 400);
  if (wantsHtml(c)) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true });
});

technician.post("/offers/:id/decline", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const error = await declineOffer(c.env, c.req.param("id"), user.id);
  if (error) return c.json({ error }, 400);
  if (wantsHtml(c)) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true });
});

technician.post("/location", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const raw = await readBody(c);
  if (raw.sharing === false || raw.sharing === "0") {
    await clearLivePosition(c.env, user.id);
    return c.json({ ok: true });
  }
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return c.json({ error: "That location could not be read." }, 400);
  }
  const profile = await c.env.DB.prepare(
    "SELECT on_duty FROM technician_profiles WHERE user_id = ?"
  ).bind(user.id).first<{ on_duty: number }>();
  if (profile?.on_duty !== 1) return c.json({ error: "Go on duty before sharing your location." }, 400);
  await c.env.DB.prepare(
    "UPDATE technician_profiles SET live_lat = ?, live_lng = ?, live_updated_at = ? WHERE user_id = ?"
  ).bind(lat, lng, nowSeconds(), user.id).run();
  return c.json({ ok: true });
});

technician.post("/jobs/:id/progress", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const contentType = c.req.header("content-type") || "";
  let raw: Record<string, unknown> = {};
  let photo: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    for (const [key, value] of form.entries()) {
      if (value instanceof File) {
        if (key === "photo" && value.size > 0) photo = value;
      } else {
        raw[key] = value;
      }
    }
  } else {
    raw = await readBody(c);
  }
  const parsed = progressSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "That update could not be saved." }, 400);
  const job = await c.env.DB.prepare(
    "SELECT id, status, assigned_tech_id FROM jobs WHERE id = ? AND assigned_tech_id = ?"
  ).bind(c.req.param("id"), user.id).first<{ id: string; status: string; assigned_tech_id: string }>();
  if (!job) return c.json({ error: "That job is not assigned to you." }, 404);
  if (NEXT[job.status] !== parsed.data.status) return c.json({ error: "Update the job one step at a time." }, 400);
  const full = await c.env.DB.prepare("SELECT trade FROM jobs WHERE id = ?").bind(job.id).first<{ trade: string }>();
  let sheet: ReturnType<typeof validateTestSheet> | null = null;
  if (parsed.data.status === "completed") {
    sheet = validateTestSheet(full?.trade || "", raw);
    if (sheet.error) return c.json({ error: sheet.error }, 400);
  }
  if (photo && (!c.env.UPLOADS || !["image/jpeg", "image/png", "image/webp"].includes(photo.type) || photo.size > 5 * 1024 * 1024)) {
    return c.json({ error: photo && !c.env.UPLOADS ? "Photo storage is not connected yet." : "Photos must be JPG, PNG or WebP, and under 5 MB." }, photo && !c.env.UPLOADS ? 503 : 400);
  }
  const now = nowSeconds();
  if (sheet && !sheet.error) {
    const existing = await c.env.DB.prepare("SELECT id FROM job_test_sheets WHERE job_id = ?").bind(job.id).first();
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO job_test_sheets (id, job_id, trade, readings_json, result, notes, filled_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), job.id, full?.trade, JSON.stringify(sheet.readings), sheet.result, sheet.notes || null, user.id, now).run();
      await c.env.DB.prepare(
        "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, 'test_sheet_recorded', ?, ?)"
      ).bind(crypto.randomUUID(), user.id, JSON.stringify({ jobId: job.id, trade: full?.trade, result: sheet.result }), now).run();
    }
  }
  const note = parsed.data.note || statusNote(parsed.data.status);
  await c.env.DB.prepare(
    `UPDATE jobs SET status = ?, updated_at = ?,
       materials = COALESCE(?, materials),
       minutes_spent = COALESCE(?, minutes_spent)
     WHERE id = ?`
  ).bind(parsed.data.status, now, parsed.data.materials || null, parsed.data.minutesSpent || null, job.id).run();
  await c.env.DB.prepare(
    "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), job.id, user.id, parsed.data.status, note, now).run();
  if (photo && c.env.UPLOADS) {
    const photoId = crypto.randomUUID();
    await c.env.UPLOADS.put(`jobs/${job.id}/${photoId}`, await photo.arrayBuffer(), {
      httpMetadata: { contentType: photo.type },
    });
    await c.env.DB.prepare(
      "INSERT INTO job_photos (id, job_id, r2_key, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(photoId, job.id, `jobs/${job.id}/${photoId}`, user.id, now).run();
  }
  if (wantsHtml(c)) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true });
});

function normalizeTrades(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const parsed = tradesSchema.safeParse([...new Set(list.map((item) => String(item).trim()).filter(Boolean))]);
  return parsed.success ? parsed.data : [];
}

function statusNote(status: string): string {
  if (status === "en_route") return "Technician on the way";
  if (status === "on_site") return "Technician on site";
  return "Work completed";
}

async function clearLivePosition(env: AppContext["Bindings"], userId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE technician_profiles SET live_lat = NULL, live_lng = NULL, live_updated_at = NULL WHERE user_id = ?"
  ).bind(userId).run();
}

function wantsHtml(c: { req: { header: (name: string) => string | undefined } }): boolean {
  return !c.req.header("accept")?.includes("application/json");
}

async function readBody(c: { req: { header: (name: string) => string | undefined; json: () => Promise<unknown>; formData: () => Promise<FormData> } }): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const body = await c.req.json();
      return body && typeof body === "object" ? body as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  const form = await c.req.formData();
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    if (key === "trades") {
      const current = raw.trades;
      raw.trades = Array.isArray(current) ? [...current, value] : [value];
    } else {
      raw[key] = value;
    }
  }
  return raw;
}
