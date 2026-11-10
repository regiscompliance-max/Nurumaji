import { Hono } from "hono";
import { detailPage, invitePage, queuePage } from "./application-pages";
import { staffDetail, staffQueue } from "./join-api";
import { loadClientJobs } from "./jobs";
import { endSession, readSession } from "./session";
import { lookupService } from "./services.mjs";
import type { AppContext, Role } from "./types";

const ASSET = "20261106d";

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

export const portal = new Hono<AppContext>();

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
  return c.html(loginPage());
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
  if (user.role !== "client") return c.html(forbiddenPage(user.role), 403);
  const groups = await loadClientJobs(c, user.id);
  const group = groups.find((item) => item.job.id === c.req.param("id"));
  if (!group) return c.html(page("Job", shell(user.phone, "<h1>Job not found</h1><p><a href=\"/portal/client\">Back to your jobs</a></p>")), 404);
  return c.html(jobPage(user.phone, group));
});

for (const role of ["client", "technician", "operator", "admin"] as const) {
  portal.get(`/${role}`, async (c) => {
    const user = await readSession(c);
    if (!user) return c.redirect("/portal/login", 303);
    if (user.role !== role) return c.html(forbiddenPage(user.role), 403);
    if (role === "client") return c.html(clientPage(user.phone, await loadClientJobs(c, user.id)));
    if (role === "technician") return c.html(await technicianDashboard(c, user));
    if (role === "operator") return c.html(await operatorDashboard(c, user));
    if (role === "admin") return c.html(await adminDashboard(c, user));
    return c.html(dashboardPage(user.role, user.phone));
  });
}

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
        ${nextStatus === "completed" ? `<div class="field"><label for="materials">Materials used</label><input id="materials" name="materials" maxlength="500"></div>
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
    ${await renewalBanner(c, user.id)}
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

async function operatorDashboard(c: { env: AppContext["Bindings"] }, user: { phone: string }): Promise<string> {
  const rows = await c.env.DB.prepare(
    `SELECT id, trade, urgency, status, address, operator_flag,
            (SELECT COUNT(*) FROM job_offers WHERE job_offers.job_id = jobs.id) AS offers
     FROM jobs
     WHERE operator_flag = 1 OR status IN ('offered', 'assigned', 'en_route', 'on_site')
     ORDER BY operator_flag DESC, updated_at DESC
     LIMIT 30`
  ).all<{ id: string; trade: string; urgency: string; status: string; address: string | null; operator_flag: number; offers: number }>();
  const roster = await technicianRoster(c, true);
  const items = (rows.results ?? []).map((job) => `<article class="portal-empty job-card">
      <p class="eyebrow">${job.operator_flag === 1 ? "Flagged for an operator" : escapeHtml(statusLabel(job.status))}</p>
      <h2>${escapeHtml(titleCase(job.trade))} · ${escapeHtml(job.urgency)}</h2>
      ${job.address ? `<p>${escapeHtml(job.address)}</p>` : "<p>No address yet.</p>"}
      <p class="muted">${job.offers} offer${job.offers === 1 ? "" : "s"} so far. ${escapeHtml(statusLabel(job.status))}.</p>
    </article>`).join("") || `<div class="portal-empty"><h2>Nothing flagged</h2><p>Jobs appear here while they are being offered, and when three offers pass with no acceptance.</p></div>`;
  return page("Dispatch", shell(user.phone, `
    <p class="eyebrow">Operator</p>
    <h1>Dispatch</h1>
    <p><a href="/portal/applications">Review applications</a></p>
    <p class="lede">Offers go out by distance. This list is the status only. Assigning a job by hand comes later.</p>
    <div class="job-stack">${items}</div>
    <h2>Technicians</h2>
    <div class="job-stack">${roster}</div>
  `));
}

async function adminDashboard(c: { env: AppContext["Bindings"] }, user: { phone: string }): Promise<string> {
  const roster = await technicianRoster(c, true);
  return page("Administration", shell(user.phone, `
    <p class="eyebrow">Admin</p>
    <h1>Administration</h1>
    <p><a href="/portal/applications">Review applications</a></p>
    <p class="lede">Other admin tools are not switched on yet. Technician photos can be replaced here.</p>
    <div class="job-stack">${roster}</div>
  `));
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

function loginPage(): string {
  return page(
    "Sign in",
    `<main class="portal-card">
      <a class="brand" href="/"><img src="/assets/logo-lockup.svg?v=${ASSET}" width="222" height="52" alt="Nuru &amp; Maji"></a>
      <div>
        <p class="eyebrow">Portal</p>
        <h1>Sign in</h1>
        <p class="lede">Use the Kenyan mobile number we can reach you on. We will send a 6-digit code by text.</p>
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
          <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required>
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

function clientPage(phone: string, groups: Awaited<ReturnType<typeof loadClientJobs>>): string {
  const items = groups.length
    ? groups.map((group) => jobBlock(group, true)).join("")
    : `<div class="portal-empty"><h2>Nothing here yet</h2><p>Nothing is booked yet. Request a visit and it will show up here.</p></div>`;
  return page("Your jobs", shell(phone, `
    <p class="eyebrow">Client</p>
    <h1>Your jobs</h1>
    <p><a class="btn btn-amber" href="/portal/book">Request a visit</a></p>
    <div class="job-stack">${items}</div>
  `));
}

function jobPage(phone: string, group: Awaited<ReturnType<typeof loadClientJobs>>[number]): string {
  return page("Job", shell(phone, `
    <p><a href="/portal/client">Your jobs</a></p>
    ${jobBlock(group, false)}
  `));
}

function jobBlock(group: Awaited<ReturnType<typeof loadClientJobs>>[number], compact: boolean): string {
  const job = group.job;
  const when = job.preferred_time ? formatWhen(job.preferred_time) : "No preferred time yet";
  const photos = group.photos.map((photo) =>
    `<img src="/api/jobs/${job.id}/photos/${photo.id}" alt="Photo attached to this request" width="160" height="120">`
  ).join("");
  const quotes = group.quotes.length
    ? group.quotes.map((quote) => {
      const approve = quote.status === "sent"
        ? `<form method="post" action="/api/jobs/${job.id}/quotes/${quote.id}/approve"><button class="btn btn-amber" type="submit">Approve quote</button></form>`
        : `<p>Status: ${escapeHtml(quote.status)}</p>`;
      return `<div><p><strong>KES ${quote.amount_kes.toLocaleString("en-KE")}</strong></p>${approve}</div>`;
    }).join("")
    : `<p class="muted">A quote will appear here when one is sent. You can approve it from this page.</p>`;
  const rating = group.rating
    ? `<p>You rated this job ${group.rating.score} out of 5.</p>`
    : job.status === "completed"
      ? `<form method="post" action="/api/jobs/${job.id}/rating"><div class="field"><label for="score">Rating</label><select id="score" name="score"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div><div class="field"><label for="comment">Comment, optional</label><textarea id="comment" name="comment" maxlength="500"></textarea></div><button class="btn btn-amber" type="submit">Save rating</button></form>`
      : `<p class="muted">You can rate the job after the work is completed.</p>`;
  const timeline = `<ol class="timeline">${group.events.map((event) =>
    `<li><time datetime="${new Date(event.created_at * 1000).toISOString()}">${escapeHtml(formatWhen(event.created_at))}</time><strong>${escapeHtml(eventLabel(event.type))}</strong>${event.note && event.note !== eventLabel(event.type) ? `<span>${escapeHtml(event.note)}</span>` : ""}</li>`
  ).join("")}</ol>`;
  const person = assignedTechnicianCard(job);
  return `<article class="portal-empty job-card">
    ${person}
    <p class="eyebrow">${escapeHtml(statusLabel(job.status))}</p>
    <h2>${escapeHtml(titleCase(job.trade))} · ${escapeHtml(job.urgency)}</h2>
    <p>${escapeHtml(job.description)}</p>
    ${job.address ? `<p>${escapeHtml(job.address)}</p>` : ""}
    <p class="muted">${escapeHtml(when)}</p>
    <h3>Timeline</h3>
    ${timeline}
    ${photos ? `<div class="photo-row">${photos}</div>` : ""}
    ${compact ? "" : `<h3>Quote</h3>${quotes}<h3>Rating</h3>${rating}`}
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
    quote_approved: "Quote approved",
    rated: "Rating saved",
  };
  return labels[type] ?? type;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
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

function page(title: string, body: string, script = false): string {
  return `<!doctype html>
<html lang="en-KE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#10242E">
<meta name="robots" content="noindex">
<title>${title} | Nuru &amp; Maji</title>
<link rel="icon" href="/assets/favicon.svg?v=${ASSET}" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css?v=${ASSET}">
<link rel="stylesheet" href="/assets/portal.css?v=${ASSET}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="main">${body}</div>
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
