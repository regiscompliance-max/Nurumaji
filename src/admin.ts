import { Hono } from "hono";
import { z } from "zod";
import { nowSeconds } from "./crypto";
import { readSession } from "./session";
import { parsePaymentSettings } from "./payments.mjs";
import { parseStuckSettings } from "./stuck-jobs.mjs";
import type { AppContext, Role } from "./types";

const ROLES = ["client", "technician", "operator", "admin"] as const;

export const adminApi = new Hono<AppContext>({ strict: false });

adminApi.use("*", async (c, next) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  if (user.role !== "admin") return c.json({ error: "Admins only." }, 403);
  c.set("user", user);
  await next();
});

adminApi.post("/users/:id/role", async (c) => {
  const actor = c.get("user");
  const body = await readAny(c);
  const parsed = z.object({ role: z.enum(ROLES) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Choose a role." }, 400);
  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(c.req.param("id")).first<{ id: string; role: Role }>();
  if (!target) return c.json({ error: "User not found." }, 404);
  if (target.role === "admin" && parsed.data.role !== "admin") {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").first<{ n: number }>();
    if ((admins?.n ?? 0) < 2) return c.json({ error: "Keep at least one admin." }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(parsed.data.role, target.id).run();
  await c.env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, 'role_changed', ?, ?)"
  ).bind(crypto.randomUUID(), actor.id, JSON.stringify({ userId: target.id, role: parsed.data.role }), nowSeconds()).run();
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin", 303);
  return c.json({ ok: true });
});

adminApi.post("/settings", async (c) => {
  const body = await readAny(c);
  const timeout = Number(body.offerTimeoutSeconds);
  if (!Number.isInteger(timeout) || timeout < 60 || timeout > 7200) return c.json({ error: "Offer timeout must be between 60 and 7200 seconds." }, 400);
  const areas = String(body.serviceAreas || "").trim().slice(0, 300);
  const pricing = String(body.pricingNote || "").trim().slice(0, 500);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('offer_timeout_seconds', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(timeout)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('service_areas', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(areas),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('pricing_note', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(pricing),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin", 303);
  return c.json({ ok: true });
});

adminApi.get("/digests/latest", async (c) => {
  let row: { period: string; period_start: number; period_end: number; label: string; stats_json: string; created_at: number } | null;
  try {
    row = await c.env.DB.prepare(
      "SELECT period, period_start, period_end, label, stats_json, created_at FROM report_snapshots ORDER BY created_at DESC LIMIT 1"
    ).first();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return c.json({ error: "No digest has been saved yet." }, 404);
    throw error;
  }
  if (!row) return c.json({ error: "No digest has been saved yet." }, 404);
  return c.json({
    period: row.period,
    label: row.label,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    savedAt: row.created_at,
    stats: JSON.parse(row.stats_json) as unknown,
  });
});

adminApi.post("/digest", async (c) => {
  const body = await readAny(c);
  const daily = body.daily === "1" || body.daily === "on" || body.daily === true;
  const weekly = body.weekly === "1" || body.weekly === "on" || body.weekly === true;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('digest_daily_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(daily ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('digest_weekly_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(weekly ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#digest", 303);
  return c.json({ ok: true });
});

adminApi.post("/payment-reminders", async (c) => {
  const body = await readAny(c);
  const parsed = parsePaymentSettings({
    dueDays: body.dueDays,
    offsets: body.offsets,
    sms: body.sms,
  });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('invoice_due_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.dueDays)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('payment_reminder_offsets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.offsets.join(",")),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('payment_reminders_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.sms ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#payment-reminders", 303);
  return c.json({ ok: true });
});

adminApi.post("/stuck-alerts", async (c) => {
  const body = await readAny(c);
  const parsed = parseStuckSettings({
    awaitingMinutes: body.awaitingMinutes,
    notStartedHours: body.notStartedHours,
    inProgressHours: body.inProgressHours,
    sms: body.sms,
  });
  if (parsed.error) return c.json({ error: parsed.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('stuck_awaiting_minutes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.awaitingMinutes)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('stuck_not_started_hours', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.notStartedHours)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('stuck_in_progress_hours', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.inProgressHours)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('stuck_alert_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.sms ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#stuck-alerts", 303);
  return c.json({ ok: true });
});

async function readAny(c: { req: { header: (name: string) => string | undefined; json: () => Promise<unknown>; formData: () => Promise<FormData> } }): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") || "";
  if (type.includes("application/json")) {
    try {
      const body = await c.req.json();
      return body && typeof body === "object" ? body as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  const form = await c.req.formData();
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") raw[key] = value;
  return raw;
}
