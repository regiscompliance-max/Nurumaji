import { Hono } from "hono";
import { endSession, readSession } from "./session";
import type { AppContext, Role } from "./types";

const ASSET = "20261106";

const COPY: Record<Role, { eyebrow: string; title: string; body: string }> = {
  client: {
    eyebrow: "Client",
    title: "Your jobs",
    body: "Nothing is booked yet. Job requests will show up here once booking is switched on.",
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

for (const role of ["client", "technician", "operator", "admin"] as const) {
  portal.get(`/${role}`, async (c) => {
    const user = await readSession(c);
    if (!user) return c.redirect("/portal/login", 303);
    if (user.role !== role) return c.html(forbiddenPage(user.role), 403);
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
