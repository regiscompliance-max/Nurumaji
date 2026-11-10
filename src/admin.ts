import { Hono } from "hono";
import { z } from "zod";
import { nowSeconds } from "./crypto";
import { readSession } from "./session";
import type { AppContext, Role } from "./types";

const ROLES = ["client", "technician", "operator", "admin"] as const;

export const adminApi = new Hono<AppContext>();

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
