import { Hono } from "hono";
import { z } from "zod";
import { nowSeconds, safeEqual, sha256, randomCode } from "./crypto";
import { normalizeKenyanMobile } from "./phone.mjs";
import { endSession, readSession, startSession } from "./session";
import { jobs } from "./jobs";
import { storeTechnicianPhoto } from "./portrait";
import { technician } from "./technician";
import { sendLoginCode } from "./sms";
import type { AppContext, UserRow } from "./types";

const CODE_TTL = 5 * 60;
const REQUEST_WINDOW = 15 * 60;
const MAX_REQUESTS_PER_PHONE = 3;
const MAX_REQUESTS_PER_IP = 15;
const MAX_ATTEMPTS = 5;

const requestSchema = z.object({ phone: z.string().trim().min(9).max(20) });
const verifySchema = z.object({
  phone: z.string().trim().min(9).max(20),
  code: z.string().regex(/^\d{6}$/),
});

export const api = new Hono<AppContext>();

api.use("*", async (c, next) => {
  if (!c.env.DB) return c.json({ error: "The portal database is not connected." }, 503);
  await next();
});

api.post("/auth/otp/request", async (c) => {
  const parsed = requestSchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Enter a Kenyan mobile number." }, 400);
  const phone = normalizeKenyanMobile(parsed.data.phone);
  if (!phone) return c.json({ error: "Enter a Kenyan mobile number starting with 07 or 01." }, 400);

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const since = nowSeconds() - REQUEST_WINDOW;
  const phoneCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND created_at > ?"
  )
    .bind(phone, since)
    .first<{ n: number }>();
  if ((phoneCount?.n ?? 0) >= MAX_REQUESTS_PER_PHONE) {
    return c.json({ error: "Too many codes for this number. Wait 15 minutes and try again." }, 429);
  }
  const ipCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM otp_codes WHERE ip = ? AND created_at > ?"
  )
    .bind(ip, since)
    .first<{ n: number }>();
  if ((ipCount?.n ?? 0) >= MAX_REQUESTS_PER_IP) {
    return c.json({ error: "Too many codes from this connection. Wait 15 minutes and try again." }, 429);
  }

  const code = randomCode();
  const now = nowSeconds();
  try {
    await sendLoginCode(c.env, phone, code);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const message = reason === "sms_not_configured"
      ? "Text messages are not configured yet."
      : "The code could not be sent. Try again shortly.";
    return c.json({ error: message }, 503);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE otp_codes SET consumed_at = ? WHERE phone = ? AND consumed_at IS NULL"
    ).bind(now, phone),
    c.env.DB.prepare(
      `INSERT INTO otp_codes (id, phone, code_hash, attempts, expires_at, created_at, ip)
       VALUES (?, ?, ?, 0, ?, ?, ?)`
    ).bind(crypto.randomUUID(), phone, await sha256(`${phone}:${code}`), now + CODE_TTL, now, ip),
  ]);

  return c.json({ ok: true, phone });
});

api.post("/auth/otp/verify", async (c) => {
  const parsed = verifySchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Enter the 6-digit code." }, 400);
  const phone = normalizeKenyanMobile(parsed.data.phone);
  if (!phone) return c.json({ error: "Enter a Kenyan mobile number starting with 07 or 01." }, 400);

  const now = nowSeconds();
  const otp = await c.env.DB.prepare(
    `SELECT id, code_hash, attempts FROM otp_codes
     WHERE phone = ? AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(phone, now)
    .first<{ id: string; code_hash: string; attempts: number }>();
  if (!otp) return c.json({ error: "That code is wrong or has expired." }, 400);
  if (otp.attempts >= MAX_ATTEMPTS) {
    return c.json({ error: "Too many attempts. Request a new code." }, 429);
  }

  const expected = await sha256(`${phone}:${parsed.data.code}`);
  if (!safeEqual(otp.code_hash, expected)) {
    await c.env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?").bind(otp.id).run();
    return c.json({ error: "That code is wrong or has expired." }, 400);
  }

  await c.env.DB.prepare("UPDATE otp_codes SET consumed_at = ? WHERE id = ?").bind(now, otp.id).run();

  let user = await c.env.DB.prepare(
    "SELECT id, phone, name, role, status, created_at FROM users WHERE phone = ?"
  )
    .bind(phone)
    .first<UserRow>();
  if (user?.status === "disabled") return c.json({ error: "This number cannot sign in." }, 403);
  if (!user) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO users (id, phone, name, role, status, created_at) VALUES (?, ?, NULL, 'client', 'active', ?)"
    )
      .bind(id, phone, now)
      .run();
    user = { id, phone, name: null, role: "client", status: "active", created_at: now };
  }

  await startSession(c, user.id);
  return c.json({ ok: true, role: user.role });
});

api.post("/auth/logout", async (c) => {
  await endSession(c);
  if (c.req.header("accept")?.includes("application/json")) return c.json({ ok: true });
  return c.redirect("/portal/login", 303);
});

api.get("/me", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  return c.json({
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    appUrl: c.env.APP_URL?.trim().replace(/\/$/, "") || new URL(c.req.url).origin,
  });
});

api.post("/me", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "Enter your name." }, 400);
  await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(parsed.data.name, user.id).run();
  return c.json({ ok: true, name: parsed.data.name });
});

api.get("/technicians/:id/photo", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  const techId = c.req.param("id");
  const allowed = await canSeeTechnicianPhoto(c.env, user, techId);
  if (!allowed) return c.json({ error: "Photo not found." }, 404);
  const profile = await c.env.DB.prepare(
    "SELECT photo_key FROM technician_profiles WHERE user_id = ?"
  ).bind(techId).first<{ photo_key: string | null }>();
  if (!profile?.photo_key || !c.env.UPLOADS) return c.json({ error: "Photo not found." }, 404);
  const object = await c.env.UPLOADS.get(profile.photo_key);
  if (!object) return c.json({ error: "Photo not found." }, 404);
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "private, no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});

api.post("/technicians/:id/photo", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  if (user.role !== "operator" && user.role !== "admin") return c.json({ error: "Staff only." }, 403);
  const tech = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'technician'"
  ).bind(c.req.param("id")).first();
  if (!tech) return c.json({ error: "Technician not found." }, 404);
  const file = await portraitFile(c);
  if (!file) return c.json({ error: "Choose a photo." }, 400);
  const stored = await storeTechnicianPhoto(c.env, c.req.param("id"), file);
  if (typeof stored !== "string") return c.json({ error: stored.error }, 400);
  if (!c.req.header("accept")?.includes("application/json")) {
    return c.redirect(user.role === "admin" ? "/portal/admin" : "/portal/operator", 303);
  }
  return c.json({ ok: true });
});

api.route("/jobs", jobs);
api.route("/technician", technician);

async function canSeeTechnicianPhoto(env: AppContext["Bindings"], viewer: UserRow, techId: string): Promise<boolean> {
  if (viewer.id === techId || viewer.role === "operator" || viewer.role === "admin") return true;
  if (viewer.role !== "client") return false;
  const job = await env.DB.prepare(
    `SELECT id FROM jobs
     WHERE client_id = ? AND assigned_tech_id = ?
       AND status IN ('assigned', 'en_route', 'on_site', 'completed', 'invoiced', 'paid')
     LIMIT 1`
  ).bind(viewer.id, techId).first();
  return Boolean(job);
}

async function portraitFile(c: { req: { formData: () => Promise<FormData> } }): Promise<File | null> {
  try {
    const form = await c.req.formData();
    const file = form.get("photo");
    return file instanceof File && file.size > 0 ? file : null;
  } catch {
    return null;
  }
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
