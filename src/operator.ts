import { Hono } from "hono";
import { z } from "zod";
import { nowSeconds } from "./crypto";
import { dispatchJob } from "./dispatch-run";
import { normalizeKenyanMobile } from "./phone.mjs";
import { readSession } from "./session";
import { sendSms } from "./sms";
import type { AppContext, UserRow } from "./types";

export const operatorApi = new Hono<AppContext>();

operatorApi.use("*", async (c, next) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  if (user.role !== "operator" && user.role !== "admin") return c.json({ error: "Staff only." }, 403);
  c.set("user", user);
  await next();
});

operatorApi.post("/jobs", async (c) => {
  const user = c.get("user");
  const body = await readAny(c);
  const phone = normalizeKenyanMobile(String(body.phone || ""));
  const parsed = z.object({
    trade: z.enum(["electrical", "plumbing"]),
    description: z.string().trim().min(8).max(2000),
    urgency: z.enum(["standard", "urgent", "emergency"]),
    address: z.string().trim().min(2).max(300),
  }).safeParse(body);
  if (!phone || !parsed.success) return c.json({ error: "Enter a Kenyan mobile, the trade, what is needed, how urgent it is, and the area." }, 400);
  const now = nowSeconds();
  let client = await c.env.DB.prepare("SELECT id, role FROM users WHERE phone = ?").bind(phone).first<{ id: string; role: string }>();
  if (!client) {
    const id = crypto.randomUUID();
    const name = String(body.name || "").trim().slice(0, 80);
    await c.env.DB.prepare(
      "INSERT INTO users (id, phone, name, role, status, created_at) VALUES (?, ?, ?, 'client', 'active', ?)"
    ).bind(id, phone, name || null, now).run();
    client = { id, role: "client" };
  }
  const jobId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO jobs (id, client_id, trade, description, urgency, address, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`
    ).bind(jobId, client.id, parsed.data.trade, parsed.data.description, parsed.data.urgency, parsed.data.address, now, now),
    c.env.DB.prepare(
      "INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'created', ?, ?)"
    ).bind(crypto.randomUUID(), jobId, user.id, "Request taken by phone", now),
  ]);
  await audit(c, user, "job_created_by_operator", { jobId });
  try { await dispatchJob(c.env, jobId); } catch (error) { console.error(error); }
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/operator", 303);
  return c.json({ ok: true, id: jobId });
});

operatorApi.post("/jobs/:id/assign", async (c) => {
  const user = c.get("user");
  const body = await readAny(c);
  const techId = String(body.techId || "");
  const tech = await c.env.DB.prepare(
    "SELECT users.id, users.phone FROM users JOIN technician_profiles ON technician_profiles.user_id = users.id WHERE users.id = ? AND users.role = 'technician' AND users.status = 'active' AND technician_profiles.approved = 1"
  ).bind(techId).first<{ id: string; phone: string }>();
  if (!tech) return c.json({ error: "Choose an approved technician." }, 400);
  const job = await c.env.DB.prepare(
    "SELECT id, status, assigned_tech_id, trade FROM jobs WHERE id = ?"
  ).bind(c.req.param("id")).first<{ id: string; status: string; assigned_tech_id: string | null; trade: string }>();
  if (!job || job.status === "cancelled" || job.status === "paid") return c.json({ error: "That job cannot be assigned." }, 400);
  const now = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE jobs SET assigned_tech_id = ?, status = 'assigned', operator_flag = 0, updated_at = ? WHERE id = ?").bind(tech.id, now, job.id),
    c.env.DB.prepare("UPDATE job_offers SET status = 'declined' WHERE job_id = ? AND status = 'offered'").bind(job.id),
    c.env.DB.prepare("INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'assigned', ?, ?)").bind(crypto.randomUUID(), job.id, user.id, "Assigned by an operator", now),
  ]);
  await audit(c, user, job.assigned_tech_id ? "job_reassigned" : "job_assigned", { jobId: job.id, techId: tech.id });
  await sendSms(c.env, tech.phone, `Nuru & Maji: a ${job.trade} job has been assigned to you. Sign in to see it.`);
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/operator", 303);
  return c.json({ ok: true });
});

operatorApi.post("/jobs/:id/quotes", async (c) => {
  const user = c.get("user");
  const body = await readAny(c);
  const amount = Number(body.amountKes);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) return c.json({ error: "Type the quote amount in whole shillings." }, 400);
  const job = await c.env.DB.prepare("SELECT id, client_id, status FROM jobs WHERE id = ?").bind(c.req.param("id")).first<{ id: string; client_id: string; status: string }>();
  if (!job || job.status === "cancelled") return c.json({ error: "That job cannot be quoted." }, 400);
  const label = String(body.itemLabel || "").trim().slice(0, 120);
  const items = label ? [{ label, amountKes: amount }] : null;
  const now = nowSeconds();
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO quotes (id, job_id, amount_kes, items_json, status, created_at) VALUES (?, ?, ?, ?, 'sent', ?)").bind(id, job.id, amount, items ? JSON.stringify(items) : null, now),
    c.env.DB.prepare("INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'quote_sent', ?, ?)").bind(crypto.randomUUID(), job.id, user.id, "Quote sent", now),
  ]);
  const phone = await phoneFor(c, job.client_id);
  if (phone) await sendSms(c.env, phone, "Nuru & Maji: a quote is ready on your job. Sign in to review it.");
  await audit(c, user, "quote_sent", { jobId: job.id, quoteId: id });
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/operator", 303);
  return c.json({ ok: true, id });
});

operatorApi.post("/jobs/:id/invoices", async (c) => {
  const user = c.get("user");
  const body = await readAny(c);
  const amount = Number(body.amountKes);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) return c.json({ error: "Type the invoice amount in whole shillings." }, 400);
  const job = await c.env.DB.prepare("SELECT id, client_id, status FROM jobs WHERE id = ?").bind(c.req.param("id")).first<{ id: string; client_id: string; status: string }>();
  if (!job || !["completed", "invoiced"].includes(job.status)) return c.json({ error: "Invoice the job after the work is completed." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM invoices WHERE job_id = ? AND status = 'issued'").bind(job.id).first();
  if (existing) return c.json({ error: "This job already has an open invoice." }, 400);
  const now = nowSeconds();
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO invoices (id, job_id, amount_kes, status) VALUES (?, ?, ?, 'issued')").bind(id, job.id, amount),
    c.env.DB.prepare("UPDATE jobs SET status = 'invoiced', updated_at = ? WHERE id = ?").bind(now, job.id),
    c.env.DB.prepare("INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'invoiced', ?, ?)").bind(crypto.randomUUID(), job.id, user.id, "Invoice sent", now),
  ]);
  const phone = await phoneFor(c, job.client_id);
  if (phone) await sendSms(c.env, phone, "Nuru & Maji: an invoice is ready on your job. Sign in to see it.");
  await audit(c, user, "invoice_issued", { jobId: job.id, invoiceId: id });
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/operator", 303);
  return c.json({ ok: true, id });
});

operatorApi.post("/jobs/:id/invoices/paid", async (c) => {
  const user = c.get("user");
  const invoice = await c.env.DB.prepare("SELECT id FROM invoices WHERE job_id = ? AND status = 'issued'").bind(c.req.param("id")).first<{ id: string }>();
  if (!invoice) return c.json({ error: "There is no open invoice to mark paid." }, 400);
  const now = nowSeconds();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?").bind(now, invoice.id),
    c.env.DB.prepare("UPDATE jobs SET status = 'paid', updated_at = ? WHERE id = ?").bind(now, c.req.param("id")),
    c.env.DB.prepare("INSERT INTO job_events (id, job_id, actor_id, type, note, created_at) VALUES (?, ?, ?, 'paid', ?, ?)").bind(crypto.randomUUID(), c.req.param("id"), user.id, "Payment recorded by an operator", now),
  ]);
  await audit(c, user, "invoice_paid", { jobId: c.req.param("id"), invoiceId: invoice.id });
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/operator", 303);
  return c.json({ ok: true });
});

async function phoneFor(c: { env: AppContext["Bindings"] }, userId: string) {
  const row = await c.env.DB.prepare("SELECT phone FROM users WHERE id = ?").bind(userId).first<{ phone: string }>();
  return row?.phone ?? null;
}

async function audit(c: { env: AppContext["Bindings"] }, user: UserRow, action: string, details: Record<string, unknown>) {
  await c.env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.id, action, JSON.stringify(details), nowSeconds()).run();
}

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
