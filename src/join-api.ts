import { Hono, type Context } from "hono";
import { z } from "zod";
import { nowSeconds, randomToken, sha256 } from "./crypto";
import { normalizeKenyanMobile } from "./phone.mjs";
import { readSession } from "./session";
import { sendSms } from "./sms";
import type { AppContext } from "./types";

const DOC_TYPES = new Set([
  "id_front", "id_back", "selfie", "epra_licence", "nca_accreditation", "trade_test", "good_conduct", "past_work",
]);
const SPECIALISMS = ["sockets", "lighting", "solar", "leaks", "drains", "tanks", "heaters"] as const;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const REOPEN = ["personal", "trade", "licences", "uploads", "coverage", "payout", "references"] as const;
const MAX_FILE = 10 * 1024 * 1024;

type ApplicationRow = {
  id: string;
  user_id: string;
  status: string;
  personal_json: string | null;
  trades: string | null;
  experience_years: number | null;
  specialisms: string | null;
  tools: number | null;
  transport: string | null;
  base_lat: number | null;
  base_lng: number | null;
  radius_km: number | null;
  availability_json: string | null;
  mpesa_number: string | null;
  references_json: string | null;
  terms_accepted_at: number | null;
  reviewer_id: string | null;
  decision_reason: string | null;
  created_at: number;
  updated_at: number;
};

export const joinApi = new Hono<AppContext>({ strict: false });

joinApi.use("*", async (c, next) => {
  const user = await readSession(c);
  if (!user) return c.json({ error: "Sign in required." }, 401);
  c.set("user", user);
  await next();
});

joinApi.get("/me", async (c) => {
  const user = c.get("user");
  const application = await openOrLatest(c.env, user.id);
  if (!application) return c.json({ application: null });
  const documents = await listDocuments(c.env, application.id);
  return c.json({ application: applicantView(application), documents: documents.map(publicDoc) });
});

joinApi.post("/start", async (c) => {
  const user = c.get("user");
  const existing = await openOrLatest(c.env, user.id);
  if (existing && existing.status === "submitted") return c.json({ error: "Your application is already with the reviewers." }, 400);
  if (existing && (existing.status === "approved" || existing.status === "probation")) {
    return c.json({ error: "This application is already approved.", application: applicantView(existing) }, 400);
  }
  const body = await readJson(c.req);
  const invite = typeof body.invite === "string" ? body.invite.trim() : "";
  let invited = false;
  if (invite) {
    const inviteRow = await c.env.DB.prepare(
      "SELECT id, expires_at, used_at FROM invites WHERE code_hash = ?"
    ).bind(await sha256(invite)).first<{ id: string; expires_at: number; used_at: number | null }>();
    const inviteOk = Boolean(inviteRow && !inviteRow.used_at && inviteRow.expires_at >= nowSeconds());
    if (!inviteOk && !existing) return c.json({ error: "That invite link is no longer valid." }, 400);
    if (inviteOk && inviteRow) {
      await c.env.DB.prepare("UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?").bind(user.id, nowSeconds(), inviteRow.id).run();
      invited = true;
    }
  }
  if (existing && (existing.status === "draft" || existing.status === "needs_info")) {
    if (invited) {
      const personal = parseJson(existing.personal_json);
      personal._invited = true;
      await c.env.DB.prepare("UPDATE technician_applications SET personal_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(personal), nowSeconds(), existing.id).run();
      existing.personal_json = JSON.stringify(personal);
    }
    return c.json({ application: applicantView(existing) });
  }
  const now = nowSeconds();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO technician_applications (id, user_id, status, personal_json, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?)`
  ).bind(id, user.id, JSON.stringify(invited ? { _invited: true } : {}), now, now).run();
  const created = await openOrLatest(c.env, user.id);
  return c.json({ application: created ? applicantView(created) : null });
});

joinApi.put("/personal", async (c) => saveSection(c, "personal", async (application, body) => {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(120).optional().or(z.literal("")),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    idNumber: z.string().trim().regex(/^\d{6,12}$/),
    kraPin: z.string().trim().regex(/^[A-Za-z]\d{9}[A-Za-z]$/),
    area: z.string().trim().min(2).max(80),
  }).safeParse(body);
  if (!parsed.success) return "Check your name, date of birth, ID, KRA PIN, and area.";
  if (!adult(parsed.data.dateOfBirth)) return "Enter a date of birth for an adult.";
  const personal = parseJson(application.personal_json);
  Object.assign(personal, {
    full_name: parsed.data.fullName,
    email: parsed.data.email || "",
    date_of_birth: parsed.data.dateOfBirth,
    id_number: parsed.data.idNumber,
    kra_pin: parsed.data.kraPin.toUpperCase(),
    area: parsed.data.area,
  });
  await c.env.DB.prepare("UPDATE technician_applications SET personal_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(personal), nowSeconds(), application.id).run();
  await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(parsed.data.fullName, application.user_id).run();
  return null;
}));

joinApi.put("/trade", async (c) => saveSection(c, "trade", async (application, body) => {
  const parsed = z.object({
    trades: z.array(z.enum(["electrical", "plumbing"])).min(1),
    experienceYears: z.coerce.number().int().min(0).max(60),
    specialisms: z.array(z.enum(SPECIALISMS)).max(SPECIALISMS.length),
    tools: z.boolean(),
    transport: z.enum(["motorbike", "car", "none"]),
  }).safeParse(body);
  if (!parsed.success) return "Check your trade, experience, and transport.";
  await c.env.DB.prepare(
    `UPDATE technician_applications
     SET trades = ?, experience_years = ?, specialisms = ?, tools = ?, transport = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    parsed.data.trades.join(","),
    parsed.data.experienceYears,
    parsed.data.specialisms.join(","),
    parsed.data.tools ? 1 : 0,
    parsed.data.transport,
    nowSeconds(),
    application.id,
  ).run();
  return null;
}));

joinApi.put("/licences", async (c) => saveSection(c, "licences", async (application, body) => {
  const parsed = z.object({
    epraNumber: z.string().trim().max(40).optional().or(z.literal("")),
    epraClass: z.string().trim().max(40).optional().or(z.literal("")),
    epraExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    ncaNumber: z.string().trim().max(40).optional().or(z.literal("")),
    goodConductIssued: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(body);
  if (!parsed.success) return "Check the licence dates.";
  const trades = (application.trades ?? "").split(",").filter(Boolean);
  if (trades.includes("electrical") && (!parsed.data.epraNumber || !parsed.data.epraClass || !parsed.data.epraExpiry)) {
    return "Enter the EPRA licence number, class, and expiry date.";
  }
  const personal = parseJson(application.personal_json);
  personal.good_conduct_issued = parsed.data.goodConductIssued;
  personal.epra_class = parsed.data.epraClass || "";
  await c.env.DB.prepare("UPDATE technician_applications SET personal_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(personal), nowSeconds(), application.id).run();
  if (trades.includes("electrical")) {
    await upsertDocumentMeta(c.env, application, "epra_licence", parsed.data.epraNumber || "", parsed.data.epraExpiry || null);
  }
  if (parsed.data.ncaNumber) await upsertDocumentMeta(c.env, application, "nca_accreditation", parsed.data.ncaNumber, null);
  return null;
}));

joinApi.post("/documents", async (c) => {
  const user = c.get("user");
  const application = await editableApplication(c.env, user.id);
  if (!application) return c.json({ error: "Start an application first." }, 400);
  if (!sectionOpen(application, "uploads") && !sectionOpen(application, "licences")) {
    return c.json({ error: "Those files are not open for changes." }, 400);
  }
  if (await limited(c.env, `upload:${user.id}`, 30, 24 * 60 * 60)) return c.json({ error: "Too many uploads. Try again later." }, 429);
  const form = await c.req.formData();
  const docType = String(form.get("docType") || "");
  const file = form.get("file");
  if (!DOC_TYPES.has(docType) || !(file instanceof File)) return c.json({ error: "Choose a file and a document type." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE) return c.json({ error: "Each file must be under 10 MB." }, 400);
  if (!isAllowedFile(file)) return c.json({ error: "Upload an image or a PDF." }, 400);
  if (!c.env.UPLOADS) return c.json({ error: "File storage is not connected yet." }, 503);
  const id = crypto.randomUUID();
  const key = `applications/${application.id}/${id}`;
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const expiryRaw = form.get("expiryDate");
  const expiry = typeof expiryRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expiryRaw) ? expiryRaw : null;
  const numberRaw = form.get("number");
  const number = typeof numberRaw === "string" ? numberRaw.slice(0, 40) : null;
  await c.env.DB.prepare(
    `INSERT INTO technician_documents
      (id, user_id, application_id, doc_type, r2_key, number, expiry_date, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(id, user.id, application.id, docType, key, number, expiry, nowSeconds()).run();
  await c.env.DB.prepare("INSERT INTO booking_limits (id, bucket, created_at) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), `upload:${user.id}`, nowSeconds()).run();
  return c.json({ ok: true, id });
});

joinApi.get("/documents/:id", async (c) => {
  const user = c.get("user");
  const doc = await c.env.DB.prepare(
    "SELECT id, user_id, r2_key FROM technician_documents WHERE id = ?"
  ).bind(c.req.param("id")).first<{ id: string; user_id: string; r2_key: string | null }>();
  if (!doc?.r2_key || !c.env.UPLOADS) return c.json({ error: "File not found." }, 404);
  const staff = user.role === "admin" || user.role === "operator";
  if (doc.user_id !== user.id && !staff) return c.json({ error: "File not found." }, 404);
  const object = await c.env.UPLOADS.get(doc.r2_key);
  if (!object) return c.json({ error: "File not found." }, 404);
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  return new Response(object.body, { headers });
});

joinApi.put("/coverage", async (c) => saveSection(c, "coverage", async (application, body) => {
  const parsed = z.object({
    baseLat: z.coerce.number().gte(-90).lte(90),
    baseLng: z.coerce.number().gte(-180).lte(180),
    radiusKm: z.coerce.number().gt(0).lte(100),
    days: z.array(z.enum(DAYS)).min(1),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }).safeParse(body);
  if (!parsed.success) return "Check the base location, radius, and working hours.";
  await c.env.DB.prepare(
    `UPDATE technician_applications
     SET base_lat = ?, base_lng = ?, radius_km = ?, availability_json = ?, updated_at = ?
     WHERE id = ?`
  ).bind(parsed.data.baseLat, parsed.data.baseLng, parsed.data.radiusKm, JSON.stringify({
    days: parsed.data.days, start: parsed.data.start, end: parsed.data.end,
  }), nowSeconds(), application.id).run();
  return null;
}));

joinApi.put("/payout", async (c) => saveSection(c, "payout", async (application, body) => {
  const phone = normalizeKenyanMobile(String(body.mpesa || ""));
  if (!phone) return "Enter an M-Pesa number we can pay.";
  await c.env.DB.prepare("UPDATE technician_applications SET mpesa_number = ?, updated_at = ? WHERE id = ?")
    .bind(phone, nowSeconds(), application.id).run();
  return null;
}));

joinApi.post("/submit", async (c) => {
  const user = c.get("user");
  const application = await editableApplication(c.env, user.id);
  if (!application) return c.json({ error: "Start an application first." }, 400);
  const referencesOpen = sectionOpen(application, "references");
  if (!referencesOpen && application.status !== "needs_info") return c.json({ error: "References are not open for changes." }, 400);
  if (await limited(c.env, `apply:${user.id}`, 5, 24 * 60 * 60)) return c.json({ error: "Too many submissions. Try again later." }, 429);
  const body = await readJson(c.req);
  let referencesJson = application.references_json;
  let termsAt = application.terms_accepted_at;
  if (referencesOpen) {
    const parsed = z.object({
      references: z.array(z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(9).max(20) })).length(2),
      terms: z.literal(true),
    }).safeParse(body);
    if (!parsed.success) return c.json({ error: "Add two references and agree to the terms." }, 400);
    const references = [];
    for (const reference of parsed.data.references) {
      const phone = normalizeKenyanMobile(reference.phone);
      if (!phone) return c.json({ error: "Enter a Kenyan mobile number for each reference." }, 400);
      references.push({ name: reference.name, phone });
    }
    referencesJson = JSON.stringify(references);
    termsAt = nowSeconds();
  } else if (!referencesJson || !termsAt) {
    return c.json({ error: "Add two references and agree to the terms." }, 400);
  }
  const missing = await missingUploads(c.env, application);
  if (missing) return c.json({ error: missing }, 400);
  const personal = parseJson(application.personal_json);
  delete personal._reopen;
  const now = nowSeconds();
  await c.env.DB.prepare(
    `UPDATE technician_applications
     SET status = 'submitted', personal_json = ?, references_json = ?, terms_accepted_at = ?, decision_reason = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(JSON.stringify(personal), referencesJson, termsAt, now, application.id).run();
  await c.env.DB.prepare("INSERT INTO booking_limits (id, bucket, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), `apply:${user.id}`, now).run();
  return c.json({ ok: true });
});

joinApi.post("/renewal", async (c) => {
  const user = c.get("user");
  if (user.role !== "technician") return c.json({ error: "Technicians only." }, 403);
  const form = await c.req.formData();
  const file = form.get("file");
  const expiry = String(form.get("expiryDate") || "");
  if (!(file instanceof File) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return c.json({ error: "Add the renewed file and its expiry date." }, 400);
  if (!isAllowedFile(file) || file.size > MAX_FILE) return c.json({ error: "Upload an image or PDF under 10 MB." }, 400);
  if (!c.env.UPLOADS) return c.json({ error: "File storage is not connected yet." }, 503);
  const application = await openOrLatest(c.env, user.id);
  if (!application) return c.json({ error: "No application to attach this renewal to." }, 400);
  const id = crypto.randomUUID();
  const key = `applications/${application.id}/${id}`;
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare(
    `INSERT INTO technician_documents
      (id, user_id, application_id, doc_type, r2_key, expiry_date, verified, created_at)
     VALUES (?, ?, ?, 'epra_licence', ?, ?, 0, ?)`
  ).bind(id, user.id, application.id, key, expiry, nowSeconds()).run();
  if (!c.req.header("accept")?.includes("application/json")) return c.redirect("/portal/technician", 303);
  return c.json({ ok: true });
});

async function saveSection(
  c: Context<AppContext>,
  section: string,
  write: (application: ApplicationRow, body: Record<string, unknown>) => Promise<string | null>,
) {
  const user = c.get("user");
  const application = await editableApplication(c.env, user.id);
  if (!application) return c.json({ error: "Start an application first." }, 400);
  if (!sectionOpen(application, section)) return c.json({ error: "That part is not open for changes." }, 400);
  const error = await write(application, await readJson(c.req));
  if (error) return c.json({ error }, 400);
  return c.json({ ok: true });
}

export async function staffQueue(env: AppContext["Bindings"], filters: { status?: string; trade?: string; area?: string }) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, status, personal_json, trades, created_at, updated_at
     FROM technician_applications WHERE status != 'draft' ORDER BY updated_at DESC LIMIT 100`
  ).all<ApplicationRow>();
  return (rows.results ?? []).filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.trade && !(row.trades ?? "").split(",").includes(filters.trade)) return false;
    if (filters.area) {
      const area = String(parseJson(row.personal_json).area || "");
      if (!area.toLowerCase().includes(filters.area.toLowerCase())) return false;
    }
    return true;
  }).map(queueView);
}

export async function staffDetail(env: AppContext["Bindings"], id: string) {
  const application = await env.DB.prepare("SELECT * FROM technician_applications WHERE id = ?").bind(id).first<ApplicationRow>();
  if (!application) return null;
  const user = await env.DB.prepare("SELECT phone, role FROM users WHERE id = ?").bind(application.user_id).first<{ phone: string; role: string }>();
  const documents = await listDocuments(env, application.id);
  const profile = await env.DB.prepare("SELECT approved FROM technician_profiles WHERE user_id = ?").bind(application.user_id).first<{ approved: number }>();
  return { application, phone: user?.phone ?? "", role: user?.role ?? "client", documents, approved: profile?.approved ?? 0 };
}

export async function setChecklist(env: AppContext["Bindings"], id: string, reviewerId: string, key: string, checked: boolean) {
  const allowed = new Set(["id_verified", "licence_verified", "good_conduct_verified", "references_called", "interview_passed"]);
  if (!allowed.has(key)) return "Unknown checklist item.";
  const application = await env.DB.prepare("SELECT id, personal_json FROM technician_applications WHERE id = ?").bind(id).first<ApplicationRow>();
  if (!application) return "Application not found.";
  const personal = parseJson(application.personal_json);
  const checklist = personal._checklist && typeof personal._checklist === "object" ? personal._checklist as Record<string, boolean> : {};
  checklist[key] = checked;
  personal._checklist = checklist;
  await env.DB.prepare("UPDATE technician_applications SET personal_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(personal), nowSeconds(), id).run();
  await audit(env, reviewerId, "application_checklist", { applicationId: id, key, checked });
  return null;
}

export async function requestInfo(env: AppContext["Bindings"], id: string, reviewerId: string, message: string, fields: string[]) {
  const reopen = fields.filter((field) => (REOPEN as readonly string[]).includes(field));
  if (!message.trim() || !reopen.length) return "Say what to fix, and choose at least one part of the form.";
  const application = await env.DB.prepare("SELECT id, user_id, personal_json, status FROM technician_applications WHERE id = ?").bind(id).first<ApplicationRow>();
  if (!application || application.status === "draft") return "That application cannot be sent back.";
  const personal = parseJson(application.personal_json);
  personal._reopen = reopen;
  const now = nowSeconds();
  await env.DB.prepare(
    "UPDATE technician_applications SET status = 'needs_info', personal_json = ?, decision_reason = ?, reviewer_id = ?, updated_at = ? WHERE id = ?"
  ).bind(JSON.stringify(personal), message.trim().slice(0, 500), reviewerId, now, id).run();
  const phone = await phoneFor(env, application.user_id);
  if (phone) await sendSms(env, phone, `Nuru & Maji: we need a correction on your application. ${message.trim().slice(0, 240)} Sign in and update the open steps.`);
  await audit(env, reviewerId, "application_request_info", { applicationId: id, fields: reopen });
  return null;
}

export async function rejectApplication(env: AppContext["Bindings"], id: string, reviewerId: string, reason: string) {
  if (!reason.trim()) return "A reason is required.";
  const application = await env.DB.prepare("SELECT id, user_id, status FROM technician_applications WHERE id = ?").bind(id).first<ApplicationRow>();
  if (!application || application.status === "draft") return "That application cannot be rejected.";
  const now = nowSeconds();
  await env.DB.prepare(
    "UPDATE technician_applications SET status = 'rejected', decision_reason = ?, reviewer_id = ?, updated_at = ? WHERE id = ?"
  ).bind(reason.trim().slice(0, 500), reviewerId, now, id).run();
  const phone = await phoneFor(env, application.user_id);
  if (phone) await sendSms(env, phone, `Nuru & Maji: your technician application was not accepted. ${reason.trim().slice(0, 240)}`);
  await audit(env, reviewerId, "application_rejected", { applicationId: id });
  return null;
}

export async function approveApplication(env: AppContext["Bindings"], id: string, reviewerId: string, probation: boolean) {
  const application = await env.DB.prepare("SELECT * FROM technician_applications WHERE id = ?").bind(id).first<ApplicationRow>();
  if (!application || (application.status !== "submitted" && application.status !== "needs_info")) return "That application is not ready to approve.";
  const now = nowSeconds();
  const status = probation ? "probation" : "approved";
  await env.DB.prepare("UPDATE technician_applications SET status = ?, reviewer_id = ?, updated_at = ? WHERE id = ?")
    .bind(status, reviewerId, now, id).run();
  await env.DB.prepare("UPDATE users SET role = 'technician' WHERE id = ?").bind(application.user_id).run();
  await env.DB.prepare(
    `INSERT INTO technician_profiles (user_id, trades, base_lat, base_lng, radius_km, on_duty, approved, rating_avg, rating_count)
     VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0)
     ON CONFLICT(user_id) DO UPDATE SET
       trades = excluded.trades, base_lat = excluded.base_lat, base_lng = excluded.base_lng,
       radius_km = excluded.radius_km, approved = 1, on_duty = 0`
  ).bind(application.user_id, application.trades ?? "", application.base_lat, application.base_lng, application.radius_km).run();
  const origin = (env.APP_URL || "").replace(/\/$/, "");
  const phone = await phoneFor(env, application.user_id);
  if (phone) await sendSms(env, phone, `Nuru & Maji: your application is approved. Sign in at ${origin}/portal/login`);
  await audit(env, reviewerId, probation ? "application_probation" : "application_approved", { applicationId: id, userId: application.user_id });
  return null;
}

export async function reapproveRenewal(env: AppContext["Bindings"], id: string, reviewerId: string) {
  const application = await env.DB.prepare("SELECT user_id FROM technician_applications WHERE id = ?").bind(id).first<ApplicationRow>();
  if (!application) return "Application not found.";
  await env.DB.prepare("UPDATE technician_profiles SET approved = 1 WHERE user_id = ?").bind(application.user_id).run();
  await env.DB.prepare(
    "UPDATE technician_documents SET verified = 1, verified_by = ? WHERE application_id = ? AND doc_type = 'epra_licence' AND verified = 0"
  ).bind(reviewerId, id).run();
  const phone = await phoneFor(env, application.user_id);
  if (phone) await sendSms(env, phone, "Nuru & Maji: your renewal was checked. You can receive offers again when you are on duty.");
  await audit(env, reviewerId, "licence_reapproved", { applicationId: id, userId: application.user_id });
  return null;
}

export async function createInvite(env: AppContext["Bindings"], createdBy: string): Promise<string> {
  const code = randomToken();
  await env.DB.prepare("INSERT INTO invites (id, code_hash, created_by, expires_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await sha256(code), createdBy, nowSeconds() + 7 * 24 * 60 * 60).run();
  await audit(env, createdBy, "invite_created", {});
  return code;
}

function applicantView(application: ApplicationRow) {
  const personal = parseJson(application.personal_json);
  return {
    id: application.id,
    status: application.status,
    invited: personal._invited === true,
    reopen: Array.isArray(personal._reopen) ? personal._reopen : [],
    personal: {
      fullName: personal.full_name || "",
      email: personal.email || "",
      dateOfBirth: personal.date_of_birth || "",
      idNumber: personal.id_number || "",
      kraPin: personal.kra_pin || "",
      area: personal.area || "",
      epraClass: personal.epra_class || "",
      goodConductIssued: personal.good_conduct_issued || "",
    },
    trades: application.trades || "",
    experienceYears: application.experience_years,
    specialisms: application.specialisms || "",
    tools: application.tools === 1,
    transport: application.transport || "",
    baseLat: application.base_lat,
    baseLng: application.base_lng,
    radiusKm: application.radius_km,
    availability: parseJson(application.availability_json),
    mpesa: application.mpesa_number || "",
    decision: application.decision_reason || "",
  };
}

function queueView(application: ApplicationRow) {
  const personal = parseJson(application.personal_json);
  return {
    id: application.id,
    status: application.status,
    name: String(personal.full_name || "Applicant"),
    area: String(personal.area || ""),
    trades: application.trades || "",
    invited: personal._invited === true,
    idMasked: maskValue(String(personal.id_number || "")),
    kraMasked: maskValue(String(personal.kra_pin || "")),
    updatedAt: application.updated_at,
  };
}

function maskValue(value: string): string {
  if (value.length <= 2) return "••••";
  return `••••${value.slice(-2)}`;
}

function parseJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function sectionOpen(application: ApplicationRow, section: string): boolean {
  if (application.status === "draft") return true;
  if (application.status !== "needs_info") return false;
  const reopen = parseJson(application.personal_json)._reopen;
  return Array.isArray(reopen) && reopen.includes(section);
}

async function editableApplication(env: AppContext["Bindings"], userId: string): Promise<ApplicationRow | null> {
  return env.DB.prepare(
    `SELECT * FROM technician_applications
     WHERE user_id = ? AND status IN ('draft', 'needs_info')
     ORDER BY updated_at DESC LIMIT 1`
  ).bind(userId).first<ApplicationRow>();
}

async function openOrLatest(env: AppContext["Bindings"], userId: string): Promise<ApplicationRow | null> {
  return env.DB.prepare(
    "SELECT * FROM technician_applications WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1"
  ).bind(userId).first<ApplicationRow>();
}

async function listDocuments(env: AppContext["Bindings"], applicationId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, doc_type, number, expiry_date, verified, r2_key, created_at FROM technician_documents WHERE application_id = ? ORDER BY created_at"
  ).bind(applicationId).all<{ id: string; doc_type: string; number: string | null; expiry_date: string | null; verified: number; r2_key: string | null; created_at: number }>();
  return rows.results ?? [];
}

function publicDoc(doc: { id: string; doc_type: string; number: string | null; expiry_date: string | null; verified: number; r2_key?: string | null }) {
  return {
    id: doc.id,
    docType: doc.doc_type,
    number: doc.number || "",
    expiryDate: doc.expiry_date || "",
    verified: doc.verified === 1,
    hasFile: Boolean(doc.r2_key),
  };
}

async function upsertDocumentMeta(env: AppContext["Bindings"], application: ApplicationRow, docType: string, number: string, expiry: string | null) {
  const existing = await env.DB.prepare(
    "SELECT id FROM technician_documents WHERE application_id = ? AND doc_type = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(application.id, docType).first<{ id: string }>();
  if (existing) {
    await env.DB.prepare("UPDATE technician_documents SET number = ?, expiry_date = ? WHERE id = ?").bind(number, expiry, existing.id).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO technician_documents (id, user_id, application_id, doc_type, number, expiry_date, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(crypto.randomUUID(), application.user_id, application.id, docType, number, expiry, nowSeconds()).run();
}

async function missingUploads(env: AppContext["Bindings"], application: ApplicationRow): Promise<string | null> {
  const files = await env.DB.prepare(
    "SELECT doc_type FROM technician_documents WHERE application_id = ? AND r2_key IS NOT NULL"
  ).bind(application.id).all<{ doc_type: string }>();
  const uploaded = new Set((files.results ?? []).map((doc) => doc.doc_type));
  for (const required of ["id_front", "id_back", "selfie", "good_conduct"]) {
    if (!uploaded.has(required)) return "Upload the ID front, ID back, a selfie, and the certificate of good conduct.";
  }
  const trades = (application.trades ?? "").split(",");
  if (trades.includes("electrical") && !uploaded.has("epra_licence")) return "Upload the EPRA licence.";
  if (trades.includes("plumbing") && !uploaded.has("trade_test")) return "Upload the trade test certificate.";
  return null;
}

function adult(isoDate: string): boolean {
  const born = Date.parse(`${isoDate}T00:00:00+03:00`);
  if (!Number.isFinite(born)) return false;
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - 18);
  return born <= limit.getTime();
}

function isAllowedFile(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type);
}

async function limited(env: AppContext["Bindings"], bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM booking_limits WHERE bucket = ? AND created_at > ?"
  ).bind(bucket, nowSeconds() - windowSeconds).first<{ n: number }>();
  return (count?.n ?? 0) >= max;
}

async function phoneFor(env: AppContext["Bindings"], userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT phone FROM users WHERE id = ?").bind(userId).first<{ phone: string }>();
  return row?.phone ?? null;
}

async function audit(env: AppContext["Bindings"], actorId: string, action: string, details: Record<string, unknown>) {
  await env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, action, details_json, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), actorId, action, JSON.stringify(details), nowSeconds()).run();
}

async function readJson(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
