import { Hono } from "hono";
import { loadClientJobs } from "./jobs";
import { endSession, readSession } from "./session";
import { lookupService } from "./services.mjs";
import type { AppContext, Role } from "./types";

const ASSET = "20261106b";

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
    return c.html(dashboardPage(user.role, user.phone));
  });
}

portal.all("*", (c) => c.html(page("Not found", "<main class=\"portal-card\"><h1>Page not found</h1><p><a href=\"/portal\">Back to the portal</a></p></main>"), 404));

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
  return `<article class="portal-empty job-card">
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}
