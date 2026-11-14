import { Hono } from "hono";
import { detailPage, invitePage, queuePage } from "./application-pages";
import { suggestTechnicians } from "./dispatch-run";
import { staffDetail, staffQueue } from "./join-api";
import { loadAnyJob, loadClientJobs } from "./jobs";
import { endSession, readSession } from "./session";
import { documentLabel } from "./compliance.mjs";
import { jobReference } from "./followups.mjs";
import { canEditRating } from "./ratings.mjs";
import { daysPastDue, invoiceReference, owedBucket } from "./payments.mjs";
import { reportsInner } from "./report-page";
import { lookupService } from "./services.mjs";
import { formatAge, reasonLabel } from "./stuck-jobs.mjs";
import type { AppContext, Role } from "./types";

const ASSET = "20261111e";

const COPY: Record<Role, { eyebrow: string; title: string; body: string }> = {
  client: {
    eyebrow: "Client",
    title: "Your jobs",
    body: "Nothing is booked yet. Request a visit and it will show up here.",
  },
  technician: {
    eyebrow: "Technician",
    title: "Your offers",
    body: "No offers yet. Assigned work will show up here once dispatch is switched on.",
  },
  operator: {
    eyebrow: "Operator",
    title: "Job board",
    body: "The live board is not switched on yet. Jobs you create or assign will show up here.",
  },
  admin: {
    eyebrow: "Admin",
    title: "Administration",
    body: "User and report tools are not switched on yet. Role changes will be recorded here.",
  },
};

export const portal = new Hono<AppContext>({ strict: false });

portal.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!c.env.DB) {
    return c.html(page("Portal", "<main class=\"portal-card\"><h1>Portal unavailable</h1><p>The database is not connected yet.</p></main>"), 503);
  }
  await next();
});

portal.get("/login", async (c) => {
  const user = await readSession(c);
  if (user) return c.redirect(dashboardPath(user.role), 303);
  let whatsApp = false;
  try {
    const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'whatsapp_otp'").first<{ value: string }>();
    whatsApp = row?.value === "1";
  } catch { whatsApp = false; }
  return c.html(loginPage(whatsApp));
});

portal.post("/logout", async (c) => {
  await endSession(c);
  return c.redirect("/portal/login", 303);
});

portal.get("/", async (c) => {
  const user = await readSession(c);
  if (!user) return c.redirect("/portal/login", 303);
  return c.redirect(dashboardPath(user.role), 303);
});

portal.get("/book", async (c) => {
  const user = await readSession(c);
  const service = c.req.query("service") ?? "";
  const urgency = c.req.query("urgency") ?? "";
  if (!user) {
    const query = new URLSearchParams();
    if (service) query.set("service", service);
    if (urgency) query.set("urgency", urgency);
    const suffix = query.toString() ? `?${query}` : "";
    return c.redirect(`/book${suffix}`, 303);
  }
  return c.html(bookingPage(user.phone, service, urgency));
});

portal.get("/jobs/:id", async (c) => {
  const user = await readSession(c);
  if (!user) return c.redirect("/portal/login", 303);
  if (user.role === "operator" || user.role === "admin") {
    const group = await loadAnyJob(c, c.req.param("id"));
    if (!group) return c.html(page("Job", shell(user.phone, "<h1>Job not found</h1><p><a href=\"/portal/operator\">Back to the board</a></p>")), 404);
    return c.html(jobPage(user.phone, group, "/portal/operator", false));
  }
  if (user.role !== "client") return c.html(forbiddenPage(user.role), 403);
  const groups = await loadClientJobs(c, user.id);
  const group = groups.find((item) => item.job.id === c.req.param("id"));
  if (!group) return c.html(page("Job", shell(user.phone, "<h1>Job not found</h1><p><a href=\"/portal/client\">Back to your jobs</a></p>")), 404);
  return c.html(jobPage(user.phone, group, "/portal/client"));
});

for (const role of ["client", "technician", "operator", "admin"] as const) {
  portal.get(`/${role}`, async (c) => {
    const user = await readSession(c);
    if (!user) return c.redirect("/portal/login", 303);
    if (user.role !== role && !(role === "operator" && user.role === "admin")) return c.html(forbiddenPage(user.role), 403);
    if (role === "client") return c.html(await clientPage(c.env, user.phone, await loadClientJobs(c, user.id)));
    if (role === "technician") return c.html(await technicianDashboard(c, user));
    if (role === "operator") return c.html(await operatorDashboard(c, user));
    if (role === "admin") return c.html(await adminDashboard(c, user));
    return c.html(dashboardPage(user.role, user.phone));
  });
}

portal.get("/admin/reports", async (c) => {
  const user = await readSession(c);
  if (!user) return c.redirect("/portal/login", 303);
  if (user.role !== "admin" && user.role !== "operator") return c.html(forbiddenPage(user.role), 403);
  const back = user.role === "admin" ? "/portal/admin" : "/portal/operator";
  const inner = await reportsInner(c.env, c.req.query("range") || "today", c.req.query("snapshot") || "");
  return c.html(page("Reports", shell(user.phone, `
    <p class="eyebrow">Reports</p>
    <h1>Reports</h1>
    <p><a href="${back}">Back</a></p>
    ${inner}
  `)));
});

portal.get("/applications", async (c) => {
  const user = await readSession(c);
  if (!user) return c.redirect("/portal/login", 303);
  if (user.role !== "admin" && user.role !== "operator") return c.html(forbiddenPage(user.role), 403);
  const items = await staffQueue(c.env, { status: c.req.query("status"), trade: c.req.query("trade"), area: c.req.query("area") });
  const setting = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'probation_completed_jobs'").first<{ value: string }>();
  return c.html(page("Applications", shell(user.phone, queuePage(items, {
    status: c.req.query("status") || "",
    trade: c.req.query("trade") || "",
    area: c.req.query("area") || "",
  }, setting?.value || ""))));
});

portal.get("/applications/invites", async (c) => {
  const user = await readSession(c);
  if (!user) return c.redirect("/portal/login", 303);
  if (user.role !== "admin") return c.html(forbiddenPage(user.role), 403);
  return c.html(page("Invite", shell(user.phone, invitePage())));
});

portal.get("/applications/:id", async (c) => {
  const user = await readSession(c);
  if (!user) return c.redirect("/portal/login", 303);
  if (user.role !== "admin" && user.role !== "operator") return c.html(forbiddenPage(user.role), 403);
  const detail = await staffDetail(c.env, c.req.param("id"));
  if (!detail) return c.html(page("Application", shell(user.phone, "<h1>Application not found</h1>")), 404);
  const personal = detail.application.personal_json ? JSON.parse(detail.application.personal_json) as Record<string, unknown> : {};
  return c.html(page("Application", shell(user.phone, detailPage({
    id: detail.application.id,
    status: detail.application.status,
    phone: detail.phone,
    role: detail.role,
    approved: detail.approved,
    personal,
    trades: detail.application.trades || "",
    experience: detail.application.experience_years,
    specialisms: detail.application.specialisms || "",
    tools: detail.application.tools,
    transport: detail.application.transport || "",
    baseLat: detail.application.base_lat,
    baseLng: detail.application.base_lng,
    radius: detail.application.radius_km,
    availability: detail.application.availability_json,
    mpesa: detail.application.mpesa_number || "",
    references: detail.application.references_json,
    reason: detail.application.decision_reason,
    documents: detail.documents,
  }))));
});

portal.all("*", (c) => c.html(page("Not found", "<main class=\"portal-card\"><h1>Page not found</h1><p><a href=\"/portal\">Back to the portal</a></p></main>"), 404));

async function technicianDashboard(c: { env: AppContext["Bindings"] }, user: { id: string; phone: string; name: string | null }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const profile = await c.env.DB.prepare(
    "SELECT trades, base_lat, base_lng, radius_km, on_duty, approved FROM technician_profiles WHERE user_id = ?"
  ).bind(user.id).first<{ trades: string; base_lat: number | null; base_lng: number | null; radius_km: number | null; on_duty: number; approved: number }>();
  const offers = await c.env.DB.prepare(
    `SELECT job_offers.id, job_offers.expires_at, jobs.trade, jobs.urgency, jobs.description, jobs.address
     FROM job_offers JOIN jobs ON jobs.id = job_offers.job_id
     WHERE job_offers.tech_id = ? AND job_offers.status = 'offered' AND job_offers.expires_at > ?
     ORDER BY job_offers.expires_at ASC`
  ).bind(user.id, now).all<{ id: string; expires_at: number; trade: string; urgency: string; description: string; address: string | null }>();
  const assigned = await c.env.DB.prepare(
    `SELECT id, trade, description, address, status FROM jobs
     WHERE assigned_tech_id = ? AND status IN ('assigned', 'en_route', 'on_site')
     ORDER BY updated_at DESC LIMIT 1`
  ).bind(user.id).first<{ id: string; trade: string; description: string; address: string | null; status: string }>();
  await c.env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").bind(user.id).run();
  const trades = new Set((profile?.trades ?? "").split(",").map((item) => item.trim()));
  const duty = profile?.on_duty === 1;
  const offerHtml = (offers.results ?? []).map((offer) => `<article class="portal-empty job-card">
      <p class="eyebrow">Offer</p>
      <h2>${escapeHtml(titleCase(offer.trade))} · ${escapeHtml(offer.urgency)}</h2>
      <p>${escapeHtml(offer.description)}</p>
      ${offer.address ? `<p>${escapeHtml(offer.address)}</p>` : ""}
      <p class="muted">Respond by ${escapeHtml(formatWhen(offer.expires_at))}.</p>
      <form method="post" action="/api/technician/offers/${offer.id}/accept"><button class="btn btn-amber" type="submit">Accept</button></form>
      <form method="post" action="/api/technician/offers/${offer.id}/decline"><button class="btn btn-line-ink" type="submit">Decline</button></form>
    </article>`).join("") || `<div class="portal-empty"><h2>No open offers</h2><p>Offers appear here when a job is within your radius and you are on duty.</p></div>`;
  const nextStatus = assigned ? ({ assigned: "en_route", en_route: "on_site", on_site: "completed" } as Record<string, string>)[assigned.status] : "";
  const nextLabel = nextStatus === "en_route" ? "Mark on the way" : nextStatus === "on_site" ? "Mark on site" : "Mark completed";
  const workHtml = assigned ? `<article class="portal-empty job-card" id="assigned-job">
      <p class="eyebrow">${escapeHtml(statusLabel(assigned.status))}</p>
      <h2>${escapeHtml(titleCase(assigned.trade))}</h2>
      <p>${escapeHtml(assigned.description)}</p>
      ${assigned.address ? `<p>${escapeHtml(assigned.address)}</p>` : ""}
      <form method="post" action="/api/technician/jobs/${assigned.id}/progress" enctype="multipart/form-data" class="form">
        <input type="hidden" name="status" value="${nextStatus}">
        <div class="field"><label for="note">Note</label><textarea id="note" name="note" maxlength="500"></textarea></div>
        ${nextStatus === "completed" ? `${testFields(assigned.trade)}<div class="field"><label for="materials">Materials used</label><input id="materials" name="materials" maxlength="500"></div>
        <div class="field"><label for="minutesSpent">Minutes spent</label><input id="minutesSpent" name="minutesSpent" inputmode="numeric"></div>` : ""}
        <div class="field"><label for="photo">Photo, optional</label><input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"></div>
        <button class="btn btn-amber" type="submit">${nextLabel}</button>
      </form>
    </article>` : "";
  const ownPhoto = await c.env.DB.prepare(
    "SELECT photo_key FROM technician_profiles WHERE user_id = ?"
  ).bind(user.id).first<{ photo_key: string | null }>();
  const portrait = avatarHtml(user.name, ownPhoto?.photo_key ? `/api/technicians/${user.id}/photo` : null, "Your profile photo");
  return page("Your offers", shell(user.phone, `
    <p class="eyebrow">Technician</p>
    <h1>Your offers</h1>
    ${await technicianRatings(c, user.id)}
    ${await renewalBanner(c, user.id)}
    ${await ownDocuments(c, user.id)}
    <form class="portrait-form" method="post" action="/api/technician/photo" enctype="multipart/form-data">
      ${portrait}
      <div class="field"><label for="portrait">Profile photo</label><input id="portrait" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></div>
      <button class="btn btn-line-ink" type="submit">Upload photo</button>
    </form>
    ${profile?.approved === 1 ? "" : `<p class="muted">An admin still has to approve this profile before any job is offered.</p>`}
    <form method="post" action="/api/technician/duty">
      <input type="hidden" name="onDuty" value="${duty ? "0" : "1"}">
      <button class="btn ${duty ? "btn-line-ink" : "btn-amber"}" type="submit">${duty ? "Go off duty" : "Go on duty"}</button>
    </form>
    <label class="trade-choice"><input id="share-location" type="checkbox"${duty ? "" : " disabled"}> Share my location while on duty</label>
    <p class="muted" id="share-note">This shares your position only while this page is open and you are on duty. It stops when you switch it off, go off duty, or leave. Operators and admins can see it. Clients cannot.</p>
    <div class="job-stack" id="offers">${offerHtml}</div>
    ${workHtml}
    <h2 id="profile">Base and radius</h2>
    <form method="post" action="/api/technician/profile" class="form">
      <label class="trade-choice"><input type="checkbox" name="trades" value="electrical"${trades.has("electrical") ? " checked" : ""}> Electrical</label>
      <label class="trade-choice"><input type="checkbox" name="trades" value="plumbing"${trades.has("plumbing") ? " checked" : ""}> Plumbing</label>
      <div class="field"><label for="radiusKm">Service radius, km</label><input id="radiusKm" name="radiusKm" inputmode="decimal" required value="${profile?.radius_km ?? ""}"></div>
      <input type="hidden" id="lat" name="baseLat" value="${profile?.base_lat ?? ""}">
      <input type="hidden" id="lng" name="baseLng" value="${profile?.base_lng ?? ""}">
      <button class="btn btn-line-ink" id="use-location" type="button">Use my location</button>
      <p class="muted" id="location-note">${profile?.base_lat != null ? "A base location is saved. You can update it." : "Set the point you travel from. This is not tracked while you are off duty."}</p>
      <button class="btn btn-amber" type="submit">Save profile</button>
    </form>
  `), true);
}

async function operatorDashboard(c: { env: AppContext["Bindings"]; req: { query: (key: string) => string | undefined } }, user: { phone: string }): Promise<string> {
  const filters = {
    status: c.req.query("status") || "",
    trade: c.req.query("trade") || "",
    urgency: c.req.query("urgency") || "",
    area: c.req.query("area") || "",
  };
  const rows = await c.env.DB.prepare(
    `SELECT id, trade, urgency, status, address, description, operator_flag
     FROM jobs
     WHERE (? = '' OR status = ?)
       AND (? = '' OR trade = ?)
       AND (? = '' OR urgency = ?)
       AND (? = '' OR lower(coalesce(address, '')) LIKE ?)
     ORDER BY operator_flag DESC, updated_at DESC
     LIMIT 40`
  ).bind(
    filters.status, filters.status,
    filters.trade, filters.trade,
    filters.urgency, filters.urgency,
    filters.area, `%${filters.area.toLowerCase().replace(/[%_]/g, "")}%`,
  ).all<{ id: string; trade: string; urgency: string; status: string; address: string | null; description: string; operator_flag: number }>();
  const techs = await c.env.DB.prepare(
    `SELECT users.id, users.name, technician_profiles.trades
     FROM users JOIN technician_profiles ON technician_profiles.user_id = users.id
     WHERE users.role = 'technician' AND users.status = 'active' AND technician_profiles.approved = 1
     ORDER BY users.name`
  ).all<{ id: string; name: string | null; trades: string }>();
  const options = (techs.results ?? []).map((tech) => `<option value="${tech.id}">${escapeHtml(tech.name || "Technician")} · ${escapeHtml(tech.trades || "trade not set")}</option>`).join("");
  const cards = [];
  for (const job of rows.results ?? []) {
    const suggestions = await suggestTechnicians(c.env, job.id);
    const suggested = suggestions.map((tech) => `<li>${escapeHtml(tech.name)} · ${tech.distanceKm} km</li>`).join("") || "<li>No one in range is on duty.</li>";
    const quoteForm = job.status === "cancelled" ? "" : `<form method="post" action="/api/operator/jobs/${job.id}/quotes" class="form">
        <div class="field"><label for="quote-${job.id}">Quote amount, KES</label><input id="quote-${job.id}" name="amountKes" inputmode="numeric" required placeholder="Type the amount"></div>
        <button class="btn btn-line-ink" type="submit">Send quote</button>
      </form>`;
    const invoiceForm = job.status === "completed" ? `<form method="post" action="/api/operator/jobs/${job.id}/invoices" class="form">
        <div class="field"><label for="invoice-${job.id}">Invoice amount, KES</label><input id="invoice-${job.id}" name="amountKes" inputmode="numeric" required placeholder="Type the amount"></div>
        <button class="btn btn-amber" type="submit">Create invoice</button>
      </form>` : "";
    const paidForm = job.status === "invoiced" ? paymentForm(job.id, "/portal/operator", "card") : "";
    cards.push(`<article class="portal-empty job-card" id="job-${job.id}">
      <p class="eyebrow">${job.operator_flag === 1 ? "Flagged" : escapeHtml(statusLabel(job.status))}</p>
      <h2>${escapeHtml(titleCase(job.trade))} · ${escapeHtml(job.urgency)}</h2>
      <p>${escapeHtml(job.description)}</p>
      ${job.address ? `<p>${escapeHtml(job.address)}</p>` : ""}
      <p><a href="/portal/jobs/${job.id}">Open job</a></p>
      <h3>Suggested</h3><ul>${suggested}</ul>
      <form method="post" action="/api/operator/jobs/${job.id}/assign" class="form">
        <div class="field"><label for="tech-${job.id}">Assign</label><select id="tech-${job.id}" name="techId" required><option value="">Choose</option>${options}</select></div>
        <button class="btn btn-amber" type="submit">Assign</button>
      </form>
      ${quoteForm}${invoiceForm}${paidForm}
    </article>`);
  }
  const select = (name: string, label: string, values: string[]) => `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}"><option value="">Any</option>${values.map((value) => `<option value="${value}"${filters[name as keyof typeof filters] === value ? " selected" : ""}>${value}</option>`).join("")}</select></div>`;
  return page("Dispatch", shell(user.phone, `
    <p class="eyebrow">Operator</p>
    <h1>Job board</h1>
    ${await alertsPanel(c)}
    ${await documentHolds(c)}
    ${await dueFollowUps(c)}
    ${await moneyOwedPanel(c, "/portal/operator")}
    <p><a href="/portal/applications">Review applications</a> · <a href="/portal/admin/reports">Reports</a></p>
    <p class="lede">Amounts are typed here. Nothing on this page has a preset price.</p>
    ${await pricingNote(c)}
    <h2>Live map</h2>
    <p class="muted">Open jobs and technicians who are sharing a location. A position older than 30 minutes is hidden. Clients do not see this map.</p>
    <div id="ops-map" class="ops-map" role="region" aria-label="Map of open jobs and on-duty technicians"></div>
    <ul class="map-legend"><li><span class="dot dot-standard"></span> Standard</li><li><span class="dot dot-urgent"></span> Urgent</li><li><span class="dot dot-emergency"></span> Emergency</li><li><span class="dot dot-tech"></span> Technician</li></ul>
    <form method="get" action="/portal/operator" class="form board-filters">
      ${select("status", "Status", ["new", "offered", "assigned", "en_route", "on_site", "completed", "invoiced", "paid", "cancelled"])}
      ${select("trade", "Trade", ["electrical", "plumbing"])}
      ${select("urgency", "Urgency", ["standard", "urgent", "emergency"])}
      <div class="field"><label for="area">Area</label><input id="area" name="area" value="${escapeHtml(filters.area)}"></div>
      <button class="btn btn-line-ink" type="submit">Filter</button>
    </form>
    <h2>Phone-in request</h2>
    <form method="post" action="/api/operator/jobs" class="form">
      <div class="field"><label for="phone">Client mobile</label><input id="phone" name="phone" type="tel" required placeholder="07XX XXX XXX"></div>
      <div class="field"><label for="client-name">Name, optional</label><input id="client-name" name="name" maxlength="80"></div>
      <div class="field"><label for="new-trade">Trade</label><select id="new-trade" name="trade"><option value="electrical">Electrical</option><option value="plumbing">Plumbing</option></select></div>
      <div class="field"><label for="new-urgency">Urgency</label><select id="new-urgency" name="urgency"><option value="standard">Standard</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div>
      <div class="field"><label for="new-address">Area</label><input id="new-address" name="address" required maxlength="300"></div>
      <div class="field"><label for="new-description">What is needed</label><textarea id="new-description" name="description" required minlength="8"></textarea></div>
      <button class="btn btn-amber" type="submit">Create job</button>
    </form>
    <div class="job-stack">${cards.join("") || "<p>No jobs match.</p>"}</div>
  `), false, true);
}

async function adminDashboard(c: { env: AppContext["Bindings"] }, user: { phone: string }): Promise<string> {
  const users = await c.env.DB.prepare(
    "SELECT id, name, phone, role, status FROM users ORDER BY created_at DESC LIMIT 80"
  ).all<{ id: string; name: string | null; phone: string; role: string; status: string }>();
  const techs = await c.env.DB.prepare(
    `SELECT users.id, users.name, technician_profiles.approved, technician_profiles.trades,
            technician_applications.id AS application_id, technician_applications.personal_json
     FROM users
     LEFT JOIN technician_profiles ON technician_profiles.user_id = users.id
     LEFT JOIN technician_applications ON technician_applications.id = (
       SELECT id FROM technician_applications AS apps WHERE apps.user_id = users.id ORDER BY updated_at DESC LIMIT 1
     )
     WHERE users.role = 'technician'
     ORDER BY users.name`
  ).all<{ id: string; name: string | null; approved: number | null; trades: string | null; application_id: string | null; personal_json: string | null }>();
  const settings = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('offer_timeout_seconds', 'service_areas', 'pricing_note', 'stuck_awaiting_minutes', 'stuck_not_started_hours', 'stuck_in_progress_hours', 'stuck_alert_sms', 'invoice_due_days', 'payment_reminder_offsets', 'payment_reminders_sms', 'digest_daily_sms', 'digest_weekly_sms', 'rating_sms', 'rating_sms_delay_hours', 'compliance_sms', 'at_balance_min_kes', 'health_sms', 'repeat_electrical_months', 'repeat_heater_months', 'repeat_sms', 'whatsapp_otp', 'whatsapp_otp_template', 'quote_followup_days', 'quote_followup_final_days', 'quote_followup_sms', 'whatsapp_quote_template')").all<{ key: string; value: string }>();
  const setting = Object.fromEntries((settings.results ?? []).map((row) => [row.key, row.value]));
  const days = await c.env.DB.prepare(
    `SELECT date(created_at, 'unixepoch', '+3 hours') AS day, COUNT(*) AS n
     FROM jobs GROUP BY day ORDER BY day DESC LIMIT 14`
  ).all<{ day: string; n: number }>();
  const revenue = await c.env.DB.prepare("SELECT COALESCE(SUM(amount_kes), 0) AS n FROM invoices WHERE status = 'paid'").first<{ n: number }>();
  const performance = await c.env.DB.prepare(
    `SELECT users.name, COUNT(jobs.id) AS jobs,
            (SELECT ROUND(AVG(score), 1) FROM ratings WHERE tech_id = users.id) AS rating
     FROM users
     LEFT JOIN jobs ON jobs.assigned_tech_id = users.id AND jobs.status IN ('completed', 'invoiced', 'paid')
     WHERE users.role = 'technician'
     GROUP BY users.id
     ORDER BY jobs DESC`
  ).all<{ name: string | null; jobs: number; rating: number | null }>();
  const response = await c.env.DB.prepare(
    `SELECT AVG(first_assigned - jobs.created_at) AS seconds
     FROM jobs
     JOIN (SELECT job_id, MIN(created_at) AS first_assigned FROM job_events WHERE type = 'assigned' GROUP BY job_id) AS firsts
       ON firsts.job_id = jobs.id`
  ).first<{ seconds: number | null }>();
  const audit = await c.env.DB.prepare(
    `SELECT action, created_at FROM audit_log
     WHERE action IN ('role_changed', 'job_assigned', 'job_reassigned')
     ORDER BY created_at DESC LIMIT 20`
  ).all<{ action: string; created_at: number }>();
  const userRows = (users.results ?? []).map((person) => `<form method="post" action="/api/admin/users/${person.id}/role" class="form">
      <p><strong>${escapeHtml(person.name || "No name")}</strong> · ${escapeHtml(person.phone)} · ${escapeHtml(person.status)}</p>
      <div class="field"><label for="role-${person.id}">Role</label><select id="role-${person.id}" name="role">${["client", "technician", "operator", "admin"].map((role) => `<option value="${role}"${person.role === role ? " selected" : ""}>${role}</option>`).join("")}</select></div>
      <button class="btn btn-line-ink" type="submit">Save role</button>
    </form>`).join("");
  const techRows = (techs.results ?? []).map((tech) => {
    let masked = "No application";
    if (tech.personal_json) {
      try {
        const idNumber = String((JSON.parse(tech.personal_json) as { id_number?: string }).id_number || "");
        masked = idNumber ? `ID ••••${idNumber.slice(-2)}` : "ID not recorded";
      } catch { masked = "ID not recorded"; }
    }
    const link = tech.application_id ? `<a href="/portal/applications/${tech.application_id}">ID and certificates</a>` : "No application on file";
    return `<article class="portal-empty"><h2>${escapeHtml(tech.name || "Technician")}</h2><p>${escapeHtml(tech.trades || "No trade")} · ${tech.approved === 1 ? "Approved" : "Not approved"}</p><p>${escapeHtml(masked)} · ${link}</p></article>`;
  }).join("") || "<p>No technicians yet.</p>";
  const dayRows = (days.results ?? []).map((row) => `<li>${escapeHtml(row.day)} · ${row.n}</li>`).join("") || "<li>No jobs yet.</li>";
  const people = (performance.results ?? []).map((row) => `<li>${escapeHtml(row.name || "Technician")} · ${row.jobs} completed · rating ${row.rating ?? "none"}</li>`).join("") || "<li>No technician stats yet.</li>";
  const minutes = response?.seconds == null ? "No assignment recorded yet." : `${Math.round(response.seconds / 60)} minutes`;
  const auditRows = (audit.results ?? []).map((row) => `<li>${escapeHtml(formatWhen(row.created_at))} · ${escapeHtml(row.action.replaceAll("_", " "))}</li>`).join("") || "<li>No role changes or reassignments yet.</li>";
  return page("Administration", shell(user.phone, `
    <p class="eyebrow">Admin</p>
    <h1>Administration</h1>
    <p><a href="/portal/applications">Review applications</a> · <a href="/portal/operator">Job board</a> · <a href="/portal/admin/reports">Reports</a></p>
    ${await moneyOwedPanel(c, "/portal/admin")}
    <h2 id="reports">Reports</h2>
    <p><a href="/portal/admin/reports">Open the reports page</a></p>
    <p>Paid invoices: KES ${(revenue?.n ?? 0).toLocaleString("en-KE")}. Average time to first assignment: ${escapeHtml(minutes)}.</p>
    <h3>Jobs per day, Nairobi</h3><ul>${dayRows}</ul>
    <h3>Technician performance</h3><ul>${people}</ul>
    <h2 id="users">Users</h2>
    <div class="job-stack">${userRows}</div>
    <h2 id="technicians">Technicians</h2>
    <p class="muted">Full ID numbers and certificate files stay on the application. This list shows the last two digits only.</p>
    <div class="job-stack">${techRows}</div>
    <section id="stuck-alerts">
    <h2>Stuck-job alerts</h2>
    <form method="post" action="/api/admin/stuck-alerts" class="form">
      <div class="field"><label for="awaiting-minutes">Waiting for a technician, minutes</label><input id="awaiting-minutes" name="awaitingMinutes" inputmode="numeric" required value="${escapeHtml(setting.stuck_awaiting_minutes || "30")}"></div>
      <div class="field"><label for="not-started-hours">Accepted but not started, hours</label><input id="not-started-hours" name="notStartedHours" inputmode="numeric" required value="${escapeHtml(setting.stuck_not_started_hours || "4")}"></div>
      <div class="field"><label for="in-progress-hours">In progress, hours</label><input id="in-progress-hours" name="inProgressHours" inputmode="numeric" required value="${escapeHtml(setting.stuck_in_progress_hours || "8")}"></div>
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.stuck_alert_sms === "1" ? " checked" : ""}> Text me stuck-job alerts</label>
      <p class="muted">Off until this is switched on. One text per check goes to each operator and admin. Texts cost money.</p>
      <button class="btn btn-amber" type="submit">Save alert settings</button>
    </form>
    </section>
    <section id="payment-reminders">
    <h2>Payment reminders</h2>
    <form method="post" action="/api/admin/payment-reminders" class="form">
      <div class="field"><label for="due-days">Invoice due after, days</label><input id="due-days" name="dueDays" inputmode="numeric" required value="${escapeHtml(setting.invoice_due_days || "7")}"></div>
      <div class="field"><label for="reminder-offsets">Reminder days after the due date</label><input id="reminder-offsets" name="offsets" required value="${escapeHtml(setting.payment_reminder_offsets || "0,3,7")}"></div>
      <p class="muted">0 is the due date. Then 3 and 7 mean three and seven days later. Commas between the numbers.</p>
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.payment_reminders_sms === "1" ? " checked" : ""}> Send payment reminders to clients</label>
      <p class="muted">Off until this is switched on. Texts go only between 08:00 and 19:00 Nairobi time, and they cost money.</p>
      <button class="btn btn-amber" type="submit">Save payment reminders</button>
    </form>
    </section>
    <section id="quote-followups">
    <h2>Quote follow-ups</h2>
    <form method="post" action="/api/admin/quote-followups" class="form">
      <div class="field"><label for="quote-days">Days with no reply</label><input id="quote-days" name="days" inputmode="numeric" required value="${escapeHtml(setting.quote_followup_days || "3")}"></div>
      <div class="field"><label for="quote-final-days">Last reminder after, days</label><input id="quote-final-days" name="finalDays" inputmode="numeric" value="${escapeHtml(setting.quote_followup_final_days || "")}" placeholder="Leave blank to send only one"></div>
      <div class="field"><label for="quote-template">WhatsApp template name</label><input id="quote-template" name="template" value="${escapeHtml(setting.whatsapp_quote_template || "nurumaji_quote_followup")}"></div>
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.quote_followup_sms === "1" ? " checked" : ""}> Send quote follow-up reminders</label>
      <p class="muted">Off until this is switched on. One reminder goes to the client after the waiting days. A later last reminder is sent only if that day count is filled in. Messages go between 08:00 and 19:00 Nairobi time. If WhatsApp sign-in codes are on, WhatsApp is tried first and a text is used when it cannot be sent. Messages cost money.</p>
      <button class="btn btn-amber" type="submit">Save quote follow-ups</button>
    </form>
    </section>
    <section id="digest">
    <h2>Daily and weekly summary</h2>
    <form method="post" action="/api/admin/digest" class="form">
      <label class="trade-choice"><input type="checkbox" name="daily" value="1"${setting.digest_daily_sms === "1" ? " checked" : ""}> Text me the daily summary</label>
      <label class="trade-choice"><input type="checkbox" name="weekly" value="1"${setting.digest_weekly_sms === "1" ? " checked" : ""}> Text me the weekly summary</label>
      <p class="muted">Both are off until switched on. One text goes to each admin at 07:00 Nairobi time. Texts cost money.</p>
      <button class="btn btn-amber" type="submit">Save summary texts</button>
    </form>
    </section>
    ${await healthPanel(c, setting)}
    ${await backupPanel(c)}
    <section id="repeat-followups">
    <h2>Repeat visits</h2>
    <form method="post" action="/api/admin/repeat" class="form">
      <div class="field"><label for="electrical-months">Electrical check, months</label><input id="electrical-months" name="electricalMonths" inputmode="numeric" required value="${escapeHtml(setting.repeat_electrical_months || "12")}"></div>
      <div class="field"><label for="heater-months">Water heater service, months</label><input id="heater-months" name="heaterMonths" inputmode="numeric" required value="${escapeHtml(setting.repeat_heater_months || "12")}"></div>
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.repeat_sms === "1" ? " checked" : ""}> Text clients when a visit is due again</label>
      <p class="muted">Off until this is switched on. A client can opt out. Texts cost money. No price is included.</p>
      <button class="btn btn-line-ink" type="submit">Save repeat visits</button>
    </form>
    </section>
    <section id="documents">
    <h2>Technician documents</h2>
    <form method="post" action="/api/admin/documents" class="form">
      <div class="field"><label for="doc-tech">Technician</label><select id="doc-tech" name="userId" required><option value="">Choose</option>${(techs.results ?? []).map((tech) => `<option value="${tech.id}">${escapeHtml(tech.name || "Technician")}</option>`).join("")}</select></div>
      <div class="field"><label for="doc-type">Document</label><select id="doc-type" name="docType"><option value="id">ID</option><option value="insurance">Insurance</option><option value="licence">Licence</option><option value="certificate">Certificate</option></select></div>
      <div class="field"><label for="doc-expiry">Expiry date</label><input id="doc-expiry" name="expiryDate" type="date" required></div>
      <button class="btn btn-amber" type="submit">Record document</button>
    </form>
    <form method="post" action="/api/admin/compliance-sms" class="form">
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.compliance_sms === "1" ? " checked" : ""}> Text document expiry reminders</label>
      <p class="muted">Off until this is switched on. Reminders still show in the portal. Texts cost money.</p>
      <button class="btn btn-line-ink" type="submit">Save document texts</button>
    </form>
    </section>
    <section id="whatsapp-otp">
    <h2>Sign-in codes</h2>
    <form method="post" action="/api/admin/whatsapp-otp" class="form">
      <div class="field"><label for="wa-template">WhatsApp template name</label><input id="wa-template" name="template" required value="${escapeHtml(setting.whatsapp_otp_template || "nurumaji_login_code")}"></div>
      <label class="trade-choice"><input type="checkbox" name="enabled" value="1"${setting.whatsapp_otp === "1" ? " checked" : ""}> Send login codes by WhatsApp</label>
      <p class="muted">Off until this is switched on. If WhatsApp cannot send the code, the portal uses a text message instead.</p>
      <button class="btn btn-amber" type="submit">Save sign-in codes</button>
    </form>
    </section>
    <section id="rating-sms">
    <h2>Customer ratings</h2>
    <form method="post" action="/api/admin/rating-sms" class="form">
      <div class="field"><label for="rating-delay">Hours after the job is completed</label><input id="rating-delay" name="delayHours" inputmode="numeric" required value="${escapeHtml(setting.rating_sms_delay_hours || "2")}"></div>
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.rating_sms === "1" ? " checked" : ""}> Ask clients for a rating by text</label>
      <p class="muted">Off until this is switched on. One text per job, between 08:00 and 19:00 Nairobi time. The link expires after 14 days. Texts cost money. The rating form in the portal stays available either way.</p>
      <button class="btn btn-amber" type="submit">Save rating texts</button>
    </form>
    </section>
    <h2 id="settings">Settings</h2>
    <form method="post" action="/api/admin/settings" class="form">
      <div class="field"><label for="offer-timeout">Offer timeout, seconds</label><input id="offer-timeout" name="offerTimeoutSeconds" inputmode="numeric" required value="${escapeHtml(setting.offer_timeout_seconds || "600")}"></div>
      <div class="field"><label for="service-areas">Service areas</label><textarea id="service-areas" name="serviceAreas" maxlength="300" placeholder="Deng to confirm. The public site says Nairobi and nearby towns.">${escapeHtml(setting.service_areas || "")}</textarea></div>
      <div class="field"><label for="pricing-note">Pricing note</label><textarea id="pricing-note" name="pricingNote" maxlength="500" placeholder="No default prices. Deng to fill this in. Quotes still need an amount typed on the job.">${escapeHtml(setting.pricing_note || "")}</textarea></div>
      <button class="btn btn-amber" type="submit">Save settings</button>
    </form>
    <h2>Role changes and reassignments</h2>
    <ul>${auditRows}</ul>
  `));
}

function paymentForm(jobId: string, back = "/portal/operator", prefix = "pay"): string {
  return `<form method="post" action="/api/operator/jobs/${jobId}/invoices/paid" class="form">
    <input type="hidden" name="next" value="${back}">
    <div class="field"><label for="method-${prefix}-${jobId}">How it was paid</label><select id="method-${prefix}-${jobId}" name="method" required><option value="">Choose</option><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank">Bank</option></select></div>
    <div class="field"><label for="code-${prefix}-${jobId}">M-Pesa code, if you have one</label><input id="code-${prefix}-${jobId}" name="mpesaCode" maxlength="20" autocapitalize="characters"></div>
    <button class="btn btn-amber" type="submit">Mark payment received</button>
  </form>`;
}

function methodLabel(method: string): string {
  if (method === "mpesa") return "M-Pesa";
  if (method === "cash") return "Cash";
  if (method === "bank") return "Bank";
  return method;
}

async function moneyOwedPanel(c: { env: AppContext["Bindings"] }, back: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const rows = await c.env.DB.prepare(
      `SELECT invoices.id, invoices.job_id, invoices.amount_kes, invoices.due_at, invoices.reminders_paused,
              users.name AS client_name,
              (SELECT COUNT(*) FROM invoice_reminders WHERE invoice_id = invoices.id) AS reminders_sent
       FROM invoices
       JOIN jobs ON jobs.id = invoices.job_id
       JOIN users ON users.id = jobs.client_id
       WHERE invoices.status = 'unpaid'
       ORDER BY invoices.due_at`
    ).all<{ id: string; job_id: string; amount_kes: number; due_at: number | null; reminders_paused: number; client_name: string | null; reminders_sent: number }>();
    const list = rows.results ?? [];
    const buckets = { "0-7": 0, "8-30": 0, "30+": 0 };
    let outstanding = 0;
    for (const row of list) {
      outstanding += row.amount_kes;
      if (row.due_at == null) continue;
      const bucket = owedBucket(daysPastDue(row.due_at, now));
      if (bucket) buckets[bucket] += row.amount_kes;
    }
    const money = (amount: number) => `KES ${amount.toLocaleString("en-KE")}`;
    const cards = list.map((row) => {
      const past = row.due_at == null ? null : daysPastDue(row.due_at, now);
      const age = past == null ? "Due date not set" : past < 0 ? `Due in ${-past} ${-past === 1 ? "day" : "days"}` : past === 0 ? "Due today" : `${past} ${past === 1 ? "day" : "days"} overdue`;
      const paused = row.reminders_paused === 1;
      const sent = Number(row.reminders_sent) || 0;
      return `<article class="money-card">
        <h3>${escapeHtml(row.client_name || "Client")} · ${money(row.amount_kes)}</h3>
        <p>Invoice ${escapeHtml(invoiceReference(row.id))} · ${escapeHtml(age)} · ${sent} reminder${sent === 1 ? "" : "s"} sent${paused ? " · reminders paused" : ""}</p>
        <p><a href="/portal/jobs/${row.job_id}">Open job</a></p>
        ${paymentForm(row.job_id, back, "owed")}
        <form method="post" action="/api/operator/invoices/${row.id}/reminders">
          <input type="hidden" name="next" value="${back}">
          <input type="hidden" name="paused" value="${paused ? "0" : "1"}">
          <button class="btn btn-line-ink" type="submit">${paused ? "Resume reminders" : "Pause reminders"}</button>
        </form>
      </article>`;
    }).join("");
    return `<section class="money-panel" id="money-owed" aria-labelledby="money-title">
      <h2 id="money-title">Money owed</h2>
      <ul class="money-totals">
        <li>Outstanding ${money(outstanding)}</li>
        <li>0–7 days ${money(buckets["0-7"])}</li>
        <li>8–30 days ${money(buckets["8-30"])}</li>
        <li>30+ days ${money(buckets["30+"])}</li>
      </ul>
      ${cards || `<p class="muted">No unpaid invoices.</p>`}
    </section>`;
  } catch {
    return `<section class="money-panel" id="money-owed"><h2>Money owed</h2><p class="muted">Money owed appears here after the latest migration is applied.</p></section>`;
  }
}

function alertCard(id: string, title: string, detail: string, jobId: string): string {
  return `<article class="alert-card">
    <h3>${escapeHtml(title)}</h3>
    <p>${detail}</p>
    <p><a href="/portal/jobs/${jobId}">Open job</a></p>
    <form method="post" action="/api/operator/alerts/${id}/acknowledge"><button class="btn btn-line-ink" type="submit">Acknowledge</button></form>
  </article>`;
}

async function alertsPanel(c: { env: AppContext["Bindings"] }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cards: string[] = [];
  try {
    const failed = await c.env.DB.prepare(
      `SELECT job_followups.id, job_followups.created_at, job_followups.return_job_id, jobs.id AS job_id, jobs.trade, jobs.address
       FROM job_followups
       JOIN jobs ON jobs.id = job_followups.original_job_id
       WHERE job_followups.acknowledged_at IS NULL
       ORDER BY job_followups.created_at`
    ).all<{ id: string; created_at: number; return_job_id: string; job_id: string; trade: string; address: string | null }>();
    for (const row of failed.results ?? []) {
      const place = row.address ? ` · ${escapeHtml(row.address)}` : "";
      cards.push(alertCard(row.id, "Failed test", `${escapeHtml(titleCase(row.trade))}${place} · ${escapeHtml(formatAge(now - row.created_at))} · return visit #${escapeHtml(jobReference(row.return_job_id))}`, row.job_id));
    }
  } catch { /* The follow-up table is added by a later migration. */ }
  try {
    const lows = await c.env.DB.prepare(
      `SELECT rating_alerts.id, rating_alerts.score, rating_alerts.opened_at, jobs.id AS job_id, jobs.trade, jobs.address
       FROM rating_alerts
       JOIN jobs ON jobs.id = rating_alerts.job_id
       WHERE rating_alerts.acknowledged_at IS NULL AND rating_alerts.score <= 2
       ORDER BY rating_alerts.opened_at`
    ).all<{ id: string; score: number; opened_at: number; job_id: string; trade: string; address: string | null }>();
    for (const row of lows.results ?? []) {
      const place = row.address ? ` · ${escapeHtml(row.address)}` : "";
      cards.push(`<article class="alert-card">
        <h3>Low rating</h3>
        <p>${escapeHtml(titleCase(row.trade))}${place} · ${row.score} out of 5 · ${escapeHtml(formatAge(now - row.opened_at))}</p>
        <p><a href="/portal/jobs/${row.job_id}">Open job</a></p>
        <form method="post" action="/api/operator/alerts/${row.id}/acknowledge" class="form">
          <div class="field"><label for="note-${row.id}">Resolution note, optional</label><textarea id="note-${row.id}" name="resolutionNote" maxlength="500"></textarea></div>
          <button class="btn btn-line-ink" type="submit">Acknowledge</button>
        </form>
      </article>`);
    }
  } catch { /* Rating alerts arrive with a later migration. */ }
  try {
    const rows = await c.env.DB.prepare(
      `SELECT job_alerts.id, job_alerts.reason, job_alerts.anchor_at, jobs.id AS job_id, jobs.trade, jobs.address
       FROM job_alerts
       JOIN jobs ON jobs.id = job_alerts.job_id
       WHERE job_alerts.acknowledged_at IS NULL AND job_alerts.resolved_at IS NULL
       ORDER BY job_alerts.opened_at`
    ).all<{ id: string; reason: string; anchor_at: number; job_id: string; trade: string; address: string | null }>();
    for (const row of rows.results ?? []) {
      const place = row.address ? ` · ${escapeHtml(row.address)}` : "";
      cards.push(alertCard(row.id, reasonLabel(row.reason), `${escapeHtml(titleCase(row.trade))}${place} · ${escapeHtml(formatAge(now - row.anchor_at))}`, row.job_id));
    }
  } catch {
    if (!cards.length) return `<section class="alert-panel" id="alerts"><h2>Alerts</h2><p class="muted">Alerts appear here after the latest migration is applied.</p></section>`;
  }
  return `<section class="alert-panel" id="alerts" aria-labelledby="alerts-title">
    <h2 id="alerts-title">Alerts</h2>
    ${cards.join("") || `<p class="muted">No alerts.</p>`}
  </section>`;
}

async function backupPanel(c: { env: AppContext["Bindings"] }): Promise<string> {
  let when = "No backup yet.";
  let status = "none";
  let link = "";
  try {
    const rows = await c.env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('backup_last_on', 'backup_last_status', 'backup_last_key')"
    ).all<{ key: string; value: string }>();
    const values = Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value]));
    if (values.backup_last_on) when = values.backup_last_on;
    status = values.backup_last_status || "none";
    if (values.backup_last_key) link = `<p><a href="/api/admin/backups/latest">Download the latest backup</a></p>`;
  } catch { /* Settings are always present. */ }
  return `<section id="backups"><h2>Backups</h2><p>Last backup ${escapeHtml(when)} · ${escapeHtml(status)}</p>${link}
    <p class="muted">A copy of the database tables is saved each night at 02:00 Nairobi time. Sign-in codes and session tokens are left out. Copies older than 30 days are removed.</p></section>`;
}

async function healthPanel(c: { env: AppContext["Bindings"] }, setting: Record<string, string>): Promise<string> {
  let status = "<p class=\"muted\">No health check has been stored yet.</p>";
  try {
    const row = await c.env.DB.prepare(
      "SELECT checked_at, database_ok, portal_ok, balance_kes, detail FROM health_checks ORDER BY checked_at DESC LIMIT 1"
    ).first<{ checked_at: number; database_ok: number; portal_ok: number; balance_kes: number | null; detail: string }>();
    if (row) {
      const balance = row.balance_kes == null ? "not read" : `KES ${Number(row.balance_kes).toLocaleString("en-KE")}`;
      status = `<ul><li>Database ${row.database_ok ? "ok" : "failed"}</li><li>Portal ${row.portal_ok ? "ok" : "failed"}</li><li>Africa's Talking balance ${balance}</li><li>${escapeHtml(row.detail)}</li></ul>`;
    }
  } catch { status = "<p class=\"muted\">Health checks appear after the latest migration is applied.</p>"; }
  const smsFailure = await lastSmsFailure(c);
  return `<section id="system-health"><h2>System health</h2>${status}${smsFailure}
    <form method="post" action="/api/admin/health" class="form">
      <div class="field"><label for="balance-min">Warn below, KES</label><input id="balance-min" name="threshold" inputmode="numeric" required value="${escapeHtml(setting.at_balance_min_kes || "50")}"></div>
      <label class="trade-choice"><input type="checkbox" name="sms" value="1"${setting.health_sms === "1" ? " checked" : ""}> Text me system warnings</label>
      <p class="muted">Off until this is switched on. Checks run every few hours. Texts cost money.</p>
      <button class="btn btn-line-ink" type="submit">Save health warnings</button>
    </form></section>`;
}

async function lastSmsFailure(c: { env: AppContext["Bindings"] }): Promise<string> {
  try {
    const rows = await c.env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('sms_last_failure_at', 'sms_last_failure_status', 'sms_last_failure_code', 'sms_last_failure_phone')"
    ).all<{ key: string; value: string }>();
    const values = Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value]));
    if (!values.sms_last_failure_at) return `<p id="sms-failure">No failed text has been recorded.</p>`;
    const when = formatWhen(Number(values.sms_last_failure_at));
    const code = values.sms_last_failure_code ? ` (${escapeHtml(values.sms_last_failure_code)})` : "";
    return `<p id="sms-failure">Last text failure: ${escapeHtml(when)} · ${escapeHtml(values.sms_last_failure_status || "Unknown")}${code} · ${escapeHtml(values.sms_last_failure_phone || "***")}</p>${await whatsAppHealth(c)}`;
  } catch {
    return `<p id="sms-failure">No failed text has been recorded.</p>${await whatsAppHealth(c)}`;
  }
}

async function whatsAppHealth(c: { env: AppContext["Bindings"] }): Promise<string> {
  const configured = c.env.WA_TOKEN && c.env.WA_PHONE_ID ? "yes" : "no";
  let failure = "No failed WhatsApp code has been recorded.";
  try {
    const rows = await c.env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('wa_last_failure_at', 'wa_last_failure_status', 'wa_last_failure_phone')"
    ).all<{ key: string; value: string }>();
    const values = Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value]));
    if (values.wa_last_failure_at) {
      failure = `Last WhatsApp failure: ${formatWhen(Number(values.wa_last_failure_at))} · ${values.wa_last_failure_status || "Unknown"} · ${values.wa_last_failure_phone || "***"}`;
    }
  } catch { /* Settings may be unread before the first failure. */ }
  return `<p id="wa-health">WhatsApp configured: ${configured}</p><p id="wa-failure">${escapeHtml(failure)}</p>`;
}

async function ownDocuments(c: { env: AppContext["Bindings"] }, userId: string): Promise<string> {
  let hold = "";
  let rows = "";
  try {
    const profile = await c.env.DB.prepare("SELECT dispatch_hold FROM technician_profiles WHERE user_id = ?").bind(userId).first<{ dispatch_hold: string | null }>();
    if (profile?.dispatch_hold) hold = `<p><strong>Dispatch is paused.</strong> ${escapeHtml(profile.dispatch_hold)}. An admin records a valid replacement before new jobs are offered.</p>`;
    const docs = await c.env.DB.prepare(
      "SELECT doc_type, expiry_date FROM compliance_documents WHERE user_id = ? AND replaced_at IS NULL ORDER BY expiry_date"
    ).bind(userId).all<{ doc_type: string; expiry_date: string }>();
    rows = (docs.results ?? []).map((doc) => `<li>${escapeHtml(documentLabel(doc.doc_type))} · expires ${escapeHtml(doc.expiry_date)}</li>`).join("");
  } catch {
    return "";
  }
  return `<section id="my-documents"><h2>Documents</h2>${hold}
    ${rows ? `<ul>${rows}</ul>` : `<p class="muted">No documents recorded yet.</p>`}
    <form method="post" action="/api/technician/documents" class="form">
      <div class="field"><label for="my-doc-type">Document</label><select id="my-doc-type" name="docType"><option value="id">ID</option><option value="insurance">Insurance</option><option value="licence">Licence</option><option value="certificate">Certificate</option></select></div>
      <div class="field"><label for="my-doc-expiry">Expiry date</label><input id="my-doc-expiry" name="expiryDate" type="date" required></div>
      <button class="btn btn-line-ink" type="submit">Record document</button>
    </form>
    <p class="muted">These dates stay private to you, operators, and admins.</p></section>`;
}

async function dueFollowUps(c: { env: AppContext["Bindings"] }): Promise<string> {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT followup_reminders.id, followup_reminders.kind, followup_reminders.due_on, jobs.trade, jobs.address, users.name
       FROM followup_reminders
       JOIN jobs ON jobs.id = followup_reminders.job_id
       JOIN users ON users.id = followup_reminders.client_id
       WHERE followup_reminders.status = 'due'
       ORDER BY followup_reminders.due_on
       LIMIT 40`
    ).all<{ id: string; kind: string; due_on: string; trade: string; address: string | null; name: string | null }>();
    const cards = (rows.results ?? []).map((row) => {
      const label = row.kind === "water_heater" ? "Water heater service" : "Electrical safety check";
      const buttons = ["contacted", "booked", "dismissed"].map((status) =>
        `<form method="post" action="/api/operator/followups/${row.id}"><input type="hidden" name="status" value="${status}"><button class="btn btn-line-ink" type="submit">${status[0].toUpperCase()}${status.slice(1)}</button></form>`
      ).join("");
      return `<article class="alert-card"><h3>${label}</h3><p>${escapeHtml(row.name || "Client")}${row.address ? ` · ${escapeHtml(row.address)}` : ""} · due ${escapeHtml(row.due_on)}</p><div class="report-nav">${buttons}</div></article>`;
    }).join("");
    return `<section id="due-followups"><h2>Due for follow-up</h2>${cards || `<p class="muted">Nothing is due.</p>`}</section>`;
  } catch {
    return "";
  }
}

async function followUpOptOut(env: AppContext["Bindings"], phone: string): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT followup_opt_out FROM users WHERE phone = ?").bind(phone).first<{ followup_opt_out: number }>();
    const checked = row?.followup_opt_out === 1 ? " checked" : "";
    return `<form method="post" action="/api/jobs/followup" class="form"><label class="trade-choice"><input type="checkbox" name="optOut" value="1"${checked}> Do not text me about a later visit</label><button class="btn btn-line-ink" type="submit">Save</button></form>`;
  } catch {
    return "";
  }
}

async function documentHolds(c: { env: AppContext["Bindings"] }): Promise<string> {
  try {
    const holds = await c.env.DB.prepare(
      `SELECT users.name, technician_profiles.dispatch_hold
       FROM technician_profiles JOIN users ON users.id = technician_profiles.user_id
       WHERE technician_profiles.dispatch_hold IS NOT NULL AND technician_profiles.dispatch_hold != ''
       ORDER BY users.name`
    ).all<{ name: string | null; dispatch_hold: string }>();
    const reminders = await c.env.DB.prepare(
      `SELECT users.name, compliance_documents.doc_type, compliance_reminders.days
       FROM compliance_reminders
       JOIN compliance_documents ON compliance_documents.id = compliance_reminders.document_id
       JOIN users ON users.id = compliance_reminders.user_id
       WHERE compliance_documents.replaced_at IS NULL
       ORDER BY compliance_reminders.days`
    ).all<{ name: string | null; doc_type: string; days: number }>();
    const holdList = (holds.results ?? []).map((row) => `<li>${escapeHtml(row.name || "Technician")} · ${escapeHtml(row.dispatch_hold)}</li>`).join("");
    const soon = (reminders.results ?? []).map((row) => `<li>${escapeHtml(row.name || "Technician")} · ${escapeHtml(documentLabel(row.doc_type))} · ${row.days} days</li>`).join("");
    if (!holdList && !soon) return "";
    return `<section id="document-holds"><h2>Documents</h2>
      ${holdList ? `<h3>Paused</h3><ul>${holdList}</ul>` : ""}
      ${soon ? `<h3>Expiring</h3><ul>${soon}</ul>` : ""}</section>`;
  } catch {
    return "";
  }
}

async function technicianRatings(c: { env: AppContext["Bindings"] }, userId: string): Promise<string> {
  try {
    const profile = await c.env.DB.prepare(
      "SELECT rating_avg, rating_count FROM technician_profiles WHERE user_id = ?"
    ).bind(userId).first<{ rating_avg: number; rating_count: number }>();
    const rows = await c.env.DB.prepare(
      `SELECT ratings.score, ratings.comment, jobs.trade
       FROM ratings JOIN jobs ON jobs.id = ratings.job_id
       WHERE ratings.tech_id = ?
       ORDER BY ratings.created_at DESC LIMIT 10`
    ).bind(userId).all<{ score: number; comment: string | null; trade: string }>();
    const count = Number(profile?.rating_count ?? 0) || 0;
    const average = count > 0 ? `${Number(profile?.rating_avg ?? 0).toFixed(1)} out of 5 from ${count}` : "No rating yet";
    const comments = (rows.results ?? []).map((row) => `<li>${row.score} out of 5 · ${escapeHtml(titleCase(row.trade))}${row.comment ? ` · ${escapeHtml(row.comment)}` : ""}</li>`).join("");
    return `<section><h2>Your ratings</h2><p>${escapeHtml(average)}</p>${comments ? `<ul>${comments}</ul>` : ""}</section>`;
  } catch {
    return "";
  }
}

async function pricingNote(c: { env: AppContext["Bindings"] }): Promise<string> {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'pricing_note'").first<{ value: string }>();
  if (!row?.value) return "";
  return `<p class="muted">${escapeHtml(row.value)}</p>`;
}

async function renewalBanner(c: { env: AppContext["Bindings"] }, userId: string): Promise<string> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const expired = await c.env.DB.prepare(
    "SELECT id FROM technician_documents WHERE user_id = ? AND expiry_date IS NOT NULL AND expiry_date < ? LIMIT 1"
  ).bind(userId, today).first();
  if (!expired) return "";
  return `<div class="portal-empty"><h2>Licence expired</h2><p>Upload the renewal. An admin checks it before you can receive new offers.</p>
    <form method="post" action="/api/join/renewal" enctype="multipart/form-data" class="form">
      <div class="field"><label for="renewal-file">Renewed licence</label><input id="renewal-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
      <div class="field"><label for="renewal-expiry">New expiry date</label><input id="renewal-expiry" name="expiryDate" type="date" required></div>
      <button class="btn btn-amber" type="submit">Upload renewal</button>
    </form></div>`;
}

async function technicianRoster(c: { env: AppContext["Bindings"] }, canReplace: boolean): Promise<string> {
  const rows = await c.env.DB.prepare(
    `SELECT users.id, users.name, technician_profiles.trades, technician_profiles.photo_key
     FROM users
     LEFT JOIN technician_profiles ON technician_profiles.user_id = users.id
     WHERE users.role = 'technician' AND users.status = 'active'
     ORDER BY users.name`
  ).all<{ id: string; name: string | null; trades: string | null; photo_key: string | null }>();
  const people = rows.results ?? [];
  if (!people.length) return `<p class="muted">No technicians yet.</p>`;
  return people.map((person) => `<article class="portal-empty person">
      ${avatarHtml(person.name, person.photo_key ? `/api/technicians/${person.id}/photo` : null, firstName(person.name))}
      <div>
        <strong>${escapeHtml(firstName(person.name))}</strong>
        <p>${escapeHtml(person.trades ? person.trades.replaceAll(",", ", ") : "No trades saved")}</p>
        ${canReplace ? `<form method="post" action="/api/technicians/${person.id}/photo" enctype="multipart/form-data" class="portrait-form"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required><button class="btn btn-line-ink" type="submit">Replace photo</button></form>` : ""}
      </div>
    </article>`).join("");
}

function dashboardPath(role: Role): string {
  return `/portal/${role}`;
}

function loginPage(whatsApp = false): string {
  const channel = whatsApp
    ? "We will send a 6-digit code by WhatsApp, or by text if WhatsApp is not available."
    : "We will send a 6-digit code by text.";
  return page(
    "Sign in",
    `<main class="portal-card">
      <a class="brand" href="/"><img src="/assets/logo-lockup.svg?v=${ASSET}" width="222" height="52" alt="Nuru &amp; Maji"></a>
      <div>
        <p class="eyebrow">Portal</p>
        <h1>Sign in</h1>
        <p class="lede">Use the Kenyan mobile number we can reach you on. ${channel}</p>
      </div>
      <form id="otp-request" class="form">
        <div class="field">
          <label for="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXX" required>
        </div>
        <button class="btn btn-amber" type="submit">Send code</button>
      </form>
      <form id="otp-verify" class="form" hidden>
        <div class="field">
          <label for="code">6-digit code</label>
          <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required>
        </div>
        <button class="btn btn-amber" type="submit">Sign in</button>
        <button class="btn btn-line-ink" id="otp-back" type="button">Use a different number</button>
      </form>
      <p class="status" id="form-status" role="status"></p>
    </main>`,
    true
  );
}

function bookingPage(phone: string, serviceKey: string, urgency: string): string {
  const service = lookupService(serviceKey);
  const trade = service?.trade ?? "electrical";
  const chosenUrgency = urgency === "urgent" || urgency === "emergency" ? urgency : "standard";
  const description = service ? service.label : "";
  return page("Request a visit", shell(phone, `
    <p class="eyebrow">Client</p>
    <h1>Request a visit</h1>
    <p class="lede">Tell us what needs doing. You will have a written price before any work starts.</p>
    <form id="booking-form" class="form">
      <input type="hidden" name="channel" value="portal">
      <input type="hidden" name="service" value="${escapeHtml(service?.key ?? "")}">
      <div class="field"><label for="trade">Trade</label>
        <select id="trade" name="trade">
          <option value="electrical"${trade === "electrical" ? " selected" : ""}>Electrical</option>
          <option value="plumbing"${trade === "plumbing" ? " selected" : ""}>Plumbing</option>
        </select>
      </div>
      <div class="field"><label for="description">What needs doing?</label>
        <textarea id="description" name="description" required minlength="8" maxlength="2000">${escapeHtml(description)}</textarea>
      </div>
      <div class="field"><label for="urgency">How urgent is it?</label>
        <select id="urgency" name="urgency">
          <option value="standard"${chosenUrgency === "standard" ? " selected" : ""}>Standard</option>
          <option value="urgent"${chosenUrgency === "urgent" ? " selected" : ""}>Urgent</option>
          <option value="emergency"${chosenUrgency === "emergency" ? " selected" : ""}>Emergency</option>
        </select>
      </div>
      <div class="field"><label for="address">Address or area</label>
        <input id="address" name="address" required maxlength="300" placeholder="Estate, road, and how to find the gate">
      </div>
      <div class="field">
        <button class="btn btn-line-ink" id="use-location" type="button">Use my location</button>
        <input type="hidden" id="lat" name="lat">
        <input type="hidden" id="lng" name="lng">
        <p class="muted" id="location-note">This shares this phone's location for this request only. You can skip it and type the address.</p>
      </div>
      <div class="field"><label for="preferredTime">Preferred date and time</label>
        <input id="preferredTime" name="preferredTime" type="datetime-local">
      </div>
      <div class="field"><label for="photos">Photos, optional</label>
        <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
      </div>
      <button class="btn btn-amber" type="submit">Send request</button>
      <p class="status" id="form-status" role="status"></p>
    </form>
  `), true);
}

async function clientPage(env: AppContext["Bindings"], phone: string, groups: Awaited<ReturnType<typeof loadClientJobs>>): Promise<string> {
  const items = groups.length
    ? groups.map((group) => jobBlock(group, true)).join("")
    : `<div class="portal-empty"><h2>Nothing here yet</h2><p>Nothing is booked yet. Request a visit and it will show up here.</p></div>`;
  return page("Your jobs", shell(phone, `
    <p class="eyebrow">Client</p>
    <h1>Your jobs</h1>
    <p><a class="btn btn-amber" href="/portal/book">Request a visit</a></p>
    ${await followUpOptOut(env, phone)}
    <div class="job-stack">${items}</div>
  `));
}

function jobPage(phone: string, group: Awaited<ReturnType<typeof loadClientJobs>>[number], back: string, forClient = true): string {
  return page("Job", shell(phone, `
    <p><a href="${back}">Back</a></p>
    ${jobBlock(group, false, forClient)}
  `));
}

function ratingBlock(
  job: { id: string; status: string },
  rating: { score: number; comment: string | null; created_at: number | null } | null,
  forClient: boolean,
  resolutionNote: string | null,
): string {
  const done = ["completed", "invoiced", "paid"].includes(job.status);
  const comment = rating?.comment ? `<p>${escapeHtml(rating.comment)}</p>` : "";
  const note = !forClient && resolutionNote ? `<p>Resolution: ${escapeHtml(resolutionNote)}</p>` : "";
  const now = Math.floor(Date.now() / 1000);
  if (forClient && done && (!rating || canEditRating(rating.created_at, now))) {
    const options = [5, 4, 3, 2, 1].map((score) =>
      `<label class="trade-choice"><input type="radio" name="score" value="${score}"${rating?.score === score ? " checked" : ""} required> ${score}</label>`
    ).join("");
    return `<form method="post" action="/api/jobs/${job.id}/rating" class="form">
      <fieldset class="test-sheet"><legend>Stars, from 1 to 5</legend>${options}</fieldset>
      <div class="field"><label for="comment-${job.id}">Comment, optional</label><textarea id="comment-${job.id}" name="comment" maxlength="500">${escapeHtml(rating?.comment || "")}</textarea></div>
      <button class="btn btn-amber" type="submit">${rating ? "Update rating" : "Save rating"}</button>
      ${rating ? `<p class="muted">You can change this for 24 hours.</p>` : ""}
    </form>`;
  }
  if (rating) return `<p>${forClient ? "You rated" : "Rated"} this job ${rating.score} out of 5.</p>${comment}${note}`;
  return `<p class="muted">${forClient ? "You can rate the job after the work is completed." : "No rating yet."}</p>${note}`;
}

function followUpLine(link: { returnJobId: string | null; originalJobId: string | null }): string {
  const lines = [];
  if (link.returnJobId) {
    lines.push(`<p>A follow-up visit is booked. Return visit: <a href="/portal/jobs/${link.returnJobId}">#${escapeHtml(jobReference(link.returnJobId))}</a></p>`);
  }
  if (link.originalJobId) {
    lines.push(`<p>Follow-up of <a href="/portal/jobs/${link.originalJobId}">#${escapeHtml(jobReference(link.originalJobId))}</a></p>`);
  }
  return lines.join("");
}

function testFields(trade: string): string {
  const note = `<p class="muted">Test sheet. Results are recorded by the technician. These fields do not set a pass mark.</p>`;
  const overall = `<div class="field"><label for="result">Overall result</label><select id="result" name="result" required><option value="">Choose</option><option value="pass">Pass</option><option value="fail">Fail</option></select></div>
    <div class="field"><label for="notes">Test notes</label><textarea id="notes" name="notes" maxlength="1000"></textarea></div>`;
  if (trade === "plumbing") {
    return `<fieldset class="test-sheet">${note}
      <div class="field"><label for="pressureBar">Pressure test, bar</label><input id="pressureBar" name="pressureBar" inputmode="decimal" required></div>
      <div class="field"><label for="durationMin">Duration, minutes</label><input id="durationMin" name="durationMin" inputmode="numeric" required></div>
      <div class="field"><label for="leakCheck">Leak check</label><select id="leakCheck" name="leakCheck" required><option value="">Choose</option><option value="pass">Pass</option><option value="fail">Fail</option></select></div>
      ${overall}</fieldset>`;
  }
  return `<fieldset class="test-sheet">${note}
    <div class="field"><label for="insulationMohm">Insulation resistance, MΩ</label><input id="insulationMohm" name="insulationMohm" inputmode="decimal" required></div>
    <div class="field"><label for="zsOhm">Earth loop impedance Zs, Ω</label><input id="zsOhm" name="zsOhm" inputmode="decimal" required></div>
    <div class="field"><label for="rcdMs">RCD trip time, ms</label><input id="rcdMs" name="rcdMs" inputmode="decimal" required></div>
    <div class="field"><label for="polarity">Polarity</label><select id="polarity" name="polarity" required><option value="">Choose</option><option value="pass">Pass</option><option value="fail">Fail</option></select></div>
    ${overall}</fieldset>`;
}

function testSheetHtml(sheet: { trade: string; readings_json: string; result: string; notes: string | null; created_at: number; filler: string | null } | null): string {
  if (!sheet) return "";
  let readings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(sheet.readings_json) as unknown;
    if (parsed && typeof parsed === "object") readings = parsed as Record<string, unknown>;
  } catch { readings = {}; }
  const labels: Record<string, string> = {
    insulationMohm: "Insulation resistance, MΩ",
    zsOhm: "Earth loop impedance Zs, Ω",
    rcdMs: "RCD trip time, ms",
    polarity: "Polarity",
    pressureBar: "Pressure test, bar",
    durationMin: "Duration, minutes",
    leakCheck: "Leak check",
  };
  const rows = Object.entries(readings).map(([key, value]) => `<li>${escapeHtml(labels[key] || key)}: ${escapeHtml(String(value ?? ""))}</li>`).join("");
  return `<section class="doc-block" id="test-sheet"><h3>Test sheet</h3>
    <p class="muted">Results are recorded by the technician.</p>
    <ul>${rows}<li>Overall result: ${escapeHtml(sheet.result)}</li>${sheet.notes ? `<li>Notes: ${escapeHtml(sheet.notes)}</li>` : ""}
    <li>Recorded ${escapeHtml(formatWhen(sheet.created_at))}${sheet.filler ? ` by ${escapeHtml(sheet.filler)}` : ""}</li></ul></section>`;
}

function jobBlock(group: Awaited<ReturnType<typeof loadClientJobs>>[number], compact: boolean, forClient = true): string {
  const job = group.job;
  const when = job.preferred_time ? formatWhen(job.preferred_time) : "No preferred time yet";
  const photos = group.photos.map((photo) =>
    `<img src="/api/jobs/${job.id}/photos/${photo.id}" alt="Photo attached to this request" width="160" height="120">`
  ).join("");
  const quotes = group.quotes.length
    ? group.quotes.map((quote) => {
      const approve = forClient && quote.status === "sent"
        ? `<form method="post" action="/api/jobs/${job.id}/quotes/${quote.id}/approve"><button class="btn btn-amber" type="submit">Approve quote</button></form>`
        : `<p>Status: ${escapeHtml(quote.status)}</p>`;
      const nudge = forClient ? "" : `<p id="quote-nudge-${quote.id}">${escapeHtml(quoteNudgeStatus(quote.nudges))}</p>`;
      return `<div><p><strong>KES ${quote.amount_kes.toLocaleString("en-KE")}</strong></p>${approve}${nudge}</div>`;
    }).join("")
    : `<p class="muted">${forClient ? "A quote will appear here when one is sent. You can approve it from this page." : "No quote has been sent."}</p>`;
  const invoices = group.invoices.length
    ? group.invoices.map((invoice) => {
      const method = invoice.payment_method ? ` · ${escapeHtml(methodLabel(invoice.payment_method))}` : "";
      const code = invoice.mpesa_code ? ` · ${escapeHtml(invoice.mpesa_code)}` : "";
      const due = invoice.due_at ? ` · due ${escapeHtml(formatWhen(invoice.due_at))}` : "";
      return `<p><strong>Invoice ${escapeHtml(invoiceReference(invoice.id))}</strong> · KES ${invoice.amount_kes.toLocaleString("en-KE")} · ${escapeHtml(invoice.status)}${due}${method}${code}</p>`;
    }).join("") + `<p class="muted">Payment through the site is not switched on. An operator records it when it has been received.</p>`
    : "";
  const rating = ratingBlock(job, group.rating, forClient, group.resolutionNote);
  const timeline = `<ol class="timeline">${group.events.map((event) =>
    `<li><time datetime="${new Date(event.created_at * 1000).toISOString()}">${escapeHtml(formatWhen(event.created_at))}</time><strong>${escapeHtml(eventLabel(event.type))}</strong>${event.note && event.note !== eventLabel(event.type) ? `<span>${escapeHtml(event.note)}</span>` : ""}</li>`
  ).join("")}</ol>`;
  const person = assignedTechnicianCard(job);
  return `<article class="portal-empty job-card">
    ${person}
    <p class="eyebrow">${escapeHtml(statusLabel(job.status))}</p>
    <h2>${escapeHtml(titleCase(job.trade))} · ${escapeHtml(job.urgency)}</h2>
    ${compact ? "" : followUpLine(group.followUp)}
    <p>${escapeHtml(job.description)}</p>
    ${job.address ? `<p>${escapeHtml(job.address)}</p>` : ""}
    <p class="muted">${escapeHtml(when)}</p>
    <h3>Timeline</h3>
    ${timeline}
    ${photos ? `<div class="photo-row">${photos}</div>` : ""}
    ${compact ? "" : `<section class="doc-block"><h3>Quote</h3>${quotes}</section>${invoices ? `<section class="doc-block"><h3>Invoice</h3>${invoices}</section>` : ""}${testSheetHtml(group.testSheet)}<h3>Rating</h3>${rating}`}
    ${compact ? `<p><a href="/portal/jobs/${job.id}">Quote and rating</a></p>` : ""}
  </article>`;
}

function shell(phone: string, inner: string): string {
  return `<header class="site-head"><div class="wrap">
      <a class="brand" href="/"><img src="/assets/logo-lockup.svg?v=${ASSET}" width="222" height="52" alt="Nuru &amp; Maji"></a>
      <form method="post" action="/portal/logout"><button class="btn btn-line-ink" type="submit">Sign out</button></form>
    </div></header>
    <main class="band"><div class="wrap portal-dash">${inner}<p class="muted">Signed in as ${escapeHtml(phone)}.</p></div></main>`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: "Request received",
    offered: "Offered to a technician",
    assigned: "Technician assigned",
    en_route: "Technician on the way",
    on_site: "Technician on site",
    completed: "Work completed",
    invoiced: "Invoice sent",
    paid: "Paid",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    created: "Request received",
    offered: "Offered to a technician",
    offer_declined: "A technician declined",
    offer_expired: "An offer expired",
    assigned: "A technician accepted",
    en_route: "Technician on the way",
    on_site: "Technician on site",
    completed: "Work completed",
    needs_operator: "Flagged for an operator",
    quote_sent: "Quote sent",
    quote_approved: "Quote approved",
    invoiced: "Invoice sent",
    paid: "Payment recorded",
    rated: "Rating saved",
  };
  return labels[type] ?? type;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function quoteNudgeStatus(nudges: { kind: string; sent_at: number }[] | undefined): string {
  const first = nudges?.find((nudge) => nudge.kind === "first");
  const last = nudges?.find((nudge) => nudge.kind === "final");
  if (!first && !last) return "Follow-up: no reminder sent.";
  const parts = [
    first ? `First reminder sent ${formatWhen(first.sent_at)}` : "First reminder not sent",
    last ? `Last reminder sent ${formatWhen(last.sent_at)}` : "Last reminder not sent",
  ];
  return `Follow-up: ${parts.join(". ")}.`;
}

function formatWhen(seconds: number): string {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(seconds * 1000));
}

function dashboardPage(role: Role, phone: string): string {
  const copy = COPY[role];
  return page(
    copy.title,
    `<header class="site-head"><div class="wrap">
      <a class="brand" href="/"><img src="/assets/logo-lockup.svg?v=${ASSET}" width="222" height="52" alt="Nuru &amp; Maji"></a>
      <form method="post" action="/portal/logout"><button class="btn btn-line-ink" type="submit">Sign out</button></form>
    </div></header>
    <main class="band"><div class="wrap portal-dash">
      <p class="eyebrow">${copy.eyebrow}</p>
      <h1>${copy.title}</h1>
      <p class="lede">Signed in as ${escapeHtml(phone)}.</p>
      <div class="portal-empty"><h2>Nothing here yet</h2><p>${copy.body}</p></div>
    </div></main>`
  );
}

function forbiddenPage(role: Role): string {
  return page(
    "Not available",
    `<main class="portal-card">
      <h1>That page is for a different role.</h1>
      <p><a href="${dashboardPath(role)}">Go to your dashboard</a></p>
    </main>`
  );
}

function page(title: string, body: string, script = false, map = false): string {
  return `<!doctype html>
<html lang="en-KE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#10242E">
<meta name="robots" content="noindex">
<title>${title} | Nuru &amp; Maji</title>
<link rel="icon" href="/assets/favicon.svg?v=${ASSET}" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css?v=${ASSET}">
<link rel="stylesheet" href="/assets/portal.css?v=${ASSET}">
${map ? `<link rel="stylesheet" href="/assets/leaflet/leaflet.css?v=${ASSET}">` : ""}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="main">${body}</div>
${map ? `<script src="/assets/leaflet/leaflet.js?v=${ASSET}" defer></script><script src="/assets/ops-map.js?v=${ASSET}" defer></script>` : ""}
${script ? `<script src="/assets/portal.js?v=${ASSET}" defer></script>` : ""}
</body>
</html>`;
}

function assignedTechnicianCard(job: { status: string; trade: string; assigned_tech_id?: string | null; tech_name?: string | null; tech_has_photo?: number | null }): string {
  const visible = new Set(["assigned", "en_route", "on_site", "completed", "invoiced", "paid"]);
  if (!job.assigned_tech_id || !visible.has(job.status)) return "";
  const name = firstName(job.tech_name ?? null);
  const src = job.tech_has_photo ? `/api/technicians/${job.assigned_tech_id}/photo` : null;
  return `<div class="person">${avatarHtml(job.tech_name ?? null, src, name)}<div><strong>${escapeHtml(name)}</strong><p>${escapeHtml(titleCase(job.trade))}</p></div></div>`;
}

function avatarHtml(name: string | null, src: string | null, label: string): string {
  if (src) return `<img class="avatar" src="${escapeHtml(src)}" alt="">`;
  return `<span class="avatar avatar-initials" role="img" aria-label="${escapeHtml(label)}">${escapeHtml(initials(name))}</span>`;
}

function firstName(name: string | null): string {
  const part = (name ?? "").trim().split(/\s+/)[0];
  return part || "Your technician";
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}
