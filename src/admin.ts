import { Hono } from "hono";
import { z } from "zod";
import { recordComplianceDocument } from "./compliance-run";
import { nowSeconds } from "./crypto";
import { readSession } from "./session";
import { parsePaymentSettings } from "./payments.mjs";
import { canMarkForMarketing, parseReportSettings } from "./job-report.mjs";
import { parseEmergencySettings } from "./emergency.mjs";
import { parseInspectionSettings } from "./inspection.mjs";
import { parseQuoteFollowUpSettings } from "./quote-followups.mjs";
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

adminApi.get("/backups/latest", async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'backup_last_key'").first<{ value: string }>();
  if (!row?.value || !c.env.UPLOADS) return c.json({ error: "No backup is stored yet." }, 404);
  const object = await c.env.UPLOADS.get(row.value);
  if (!object) return c.json({ error: "No backup is stored yet." }, 404);
  const filename = row.value.split("/").pop() || "backup.json";
  return new Response(object.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});

adminApi.post("/repeat", async (c) => {
  const body = await readAny(c);
  const electrical = Number(body.electricalMonths);
  const heater = Number(body.heaterMonths);
  if (!Number.isInteger(electrical) || electrical < 1 || electrical > 36 || !Number.isInteger(heater) || heater < 1 || heater > 36) {
    return c.json({ error: "Enter each interval as a whole number of months from 1 to 36." }, 400);
  }
  const sms = body.sms === "1" || body.sms === "on" || body.sms === true;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('repeat_electrical_months', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(electrical)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('repeat_heater_months', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(heater)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('repeat_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(sms ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#repeat-followups", 303);
  return c.json({ ok: true });
});

adminApi.post("/health", async (c) => {
  const body = await readAny(c);
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100000) return c.json({ error: "Enter a balance threshold in shillings." }, 400);
  const sms = body.sms === "1" || body.sms === "on" || body.sms === true;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('at_balance_min_kes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(Math.round(threshold))),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('health_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(sms ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#system-health", 303);
  return c.json({ ok: true });
});

adminApi.post("/documents", async (c) => {
  const actor = c.get("user");
  const body = await readAny(c);
  const saved = await recordComplianceDocument(c.env, {
    userId: String(body.userId || ""),
    docType: String(body.docType || ""),
    expiryDate: String(body.expiryDate || ""),
    actorId: actor.id,
    asAdmin: true,
  });
  if (saved.error) return c.json({ error: saved.error }, 400);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#documents", 303);
  return c.json({ ok: true });
});

adminApi.post("/compliance-sms", async (c) => {
  const body = await readAny(c);
  const sms = body.sms === "1" || body.sms === "on" || body.sms === true;
  await c.env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('compliance_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(sms ? "1" : "0").run();
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#documents", 303);
  return c.json({ ok: true });
});

adminApi.post("/whatsapp-otp", async (c) => {
  const body = await readAny(c);
  const template = String(body.template || "").trim();
  if (!/^[a-z0-9_]{1,64}$/.test(template)) return c.json({ error: "The template name can use lowercase letters, numbers, and underscores." }, 400);
  const enabled = body.enabled === "1" || body.enabled === "on" || body.enabled === true;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_otp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(enabled ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_otp_template', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(template),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#whatsapp-otp", 303);
  return c.json({ ok: true });
});

adminApi.post("/rating-sms", async (c) => {
  const body = await readAny(c);
  const delay = Number(body.delayHours);
  if (!Number.isInteger(delay) || delay < 1 || delay > 72) return c.json({ error: "The delay must be a whole number of hours from 1 to 72." }, 400);
  const sms = body.sms === "1" || body.sms === "on" || body.sms === true;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('rating_sms_delay_hours', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(delay)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('rating_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(sms ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#rating-sms", 303);
  return c.json({ ok: true });
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

adminApi.post("/photos/:id/marketing", async (c) => {
  const body = await readAny(c);
  const photo = await c.env.DB.prepare(
    `SELECT job_photos.id, jobs.photo_consent, jobs.id AS job_id
     FROM job_photos JOIN jobs ON jobs.id = job_photos.job_id
     WHERE job_photos.id = ?`
  ).bind(c.req.param("id")).first<{ id: string; photo_consent: number | null; job_id: string }>();
  if (!photo) return c.json({ error: "Photo not found." }, 404);
  const decision = canMarkForMarketing({ consent: photo.photo_consent === 1, requested: body.ok === "1" || body.ok === "on" || body.ok === true });
  if (!decision.ok) return c.json({ error: decision.error }, 400);
  await c.env.DB.prepare("UPDATE job_photos SET marketing_ok = ? WHERE id = ?").bind(decision.value, photo.id).run();
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect(`/portal/jobs/${photo.job_id}`, 303);
  return c.json({ ok: true });
});

adminApi.post("/job-reports", async (c) => {
  const body = await readAny(c);
  const parsed = parseReportSettings({
    photosRequired: body.photosRequired,
    sms: body.sms,
    repairDays: body.repairDays,
    installMonths: body.installMonths,
    template: body.template,
  });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('close_photos_required', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.photosRequired ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('close_report_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.sms ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('warranty_repair_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.repairDays)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('warranty_install_months', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.installMonths)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_report_template', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.template),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#job-reports", 303);
  return c.json({ ok: true });
});

adminApi.post("/technicians/:id/on-call", async (c) => {
  const body = await readAny(c);
  const onCall = body.onCall === "1" || body.onCall === "on" || body.onCall === true;
  const profile = await c.env.DB.prepare("SELECT user_id FROM technician_profiles WHERE user_id = ?").bind(c.req.param("id")).first();
  if (!profile) return c.json({ error: "That technician has no profile yet." }, 400);
  await c.env.DB.prepare("UPDATE technician_profiles SET on_call = ? WHERE user_id = ?").bind(onCall ? 1 : 0, c.req.param("id")).run();
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#emergency-settings", 303);
  return c.json({ ok: true });
});

adminApi.post("/emergency", async (c) => {
  const body = await readAny(c);
  const parsed = parseEmergencySettings({
    bookings: body.bookings,
    minKes: body.minKes,
    nightPercent: body.nightPercent,
    weekendPercent: body.weekendPercent,
    targetHours: body.targetHours,
    showTarget: body.showTarget,
    alert: body.alert,
    servicesNumber: body.servicesNumber,
    template: body.template,
  });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_bookings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.bookings ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_min_kes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.minKes)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_night_percent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.nightPercent)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_weekend_percent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.weekendPercent)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_target_hours', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.targetHours)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_show_target', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.showTarget ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_alert', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.alert ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('emergency_services_number', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.servicesNumber),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_emergency_template', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.template),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#emergency-settings", 303);
  return c.json({ ok: true });
});

adminApi.post("/inspection", async (c) => {
  const body = await readAny(c);
  const parsed = parseInspectionSettings({ price: body.price, sms: body.sms });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('inspection_price_from', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.price),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('inspection_reminder_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.sms ? "1" : "0"),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#inspection-settings", 303);
  return c.json({ ok: true });
});

adminApi.post("/quote-followups", async (c) => {
  const body = await readAny(c);
  const parsed = parseQuoteFollowUpSettings({
    days: body.days,
    finalDays: body.finalDays,
    sms: body.sms,
    template: body.template,
  });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('quote_followup_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(parsed.days)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('quote_followup_final_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.finalDays == null ? "" : String(parsed.finalDays)),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('quote_followup_sms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.sms ? "1" : "0"),
    c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('whatsapp_quote_template', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(parsed.template),
  ]);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/admin#quote-followups", 303);
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
