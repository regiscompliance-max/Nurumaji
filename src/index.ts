import { Hono, type Context } from "hono";
import { api } from "./api";
import { expireOffers } from "./dispatch-run";
import { isCrossSite, needsOriginCheck, withoutTrailingSlash } from "./http-guards.mjs";
import { licenceCheck } from "./licence-check";
import { writeDigests } from "./report-run";
import { checkPaymentReminders } from "./payment-run";
import { checkStuckJobs } from "./stuck-run";
import { portal } from "./portal";
import type { AppContext, Bindings } from "./types";

const app = new Hono<AppContext>({ strict: false });

app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    const target = withoutTrailingSlash(c.req.url);
    if (target) {
      c.res = c.redirect(target.toString(), 301);
      c.res = stamp(c, c.res);
      return;
    }
  }
  if (needsOriginCheck(c.req.method) && isCrossSite(c.req.url, c.req.header("origin") ?? null, c.req.header("sec-fetch-site") ?? null)) {
    c.res = stamp(c, errorResponse(c, "That request was rejected.", 403));
    return;
  }
  await next();
  if (browserPage(c) && c.res.status >= 400 && (c.res.headers.get("content-type") || "").includes("application/json")) {
    const body = await c.res.clone().json().catch(() => null) as { error?: unknown } | null;
    const message = body && typeof body.error === "string" ? body.error : "Something went wrong.";
    const status = c.res.status;
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 429 || status === 500 || status === 503) {
      c.res = c.html(errorPage(message), status);
    }
  }
  c.res = stamp(c, c.res);
});

app.route("/api", api);
app.route("/portal", portal);

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  console.error(error);
  return stamp(c, errorResponse(c, "Something went wrong.", 500));
});

function stamp(c: Context<AppContext>, res: Response): Response {
  const headers = new Headers(res.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  const geo = c.req.path === "/join" || c.req.path.startsWith("/portal") ? "geolocation=(self)" : "geolocation=()";
  headers.set("Permissions-Policy", `camera=(), microphone=(), ${geo}, payment=(), usb=()`);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (new URL(c.req.url).protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self'"
  );
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function browserPage(c: Context<AppContext>): boolean {
  const accept = c.req.header("accept") || "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function errorResponse(c: Context<AppContext>, message: string, status: 400 | 403 | 500): Response {
  if (browserPage(c)) return c.html(errorPage(message), status);
  return c.json({ error: message }, status);
}

function errorPage(message: string): string {
  const safe = message.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
  return `<!doctype html><html lang="en-KE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Something went wrong | Nuru &amp; Maji</title></head><body><main><h1>Something went wrong</h1><p>${safe}</p><p><a href="/">Back to the site</a></p></main></body></html>`;
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([expireOffers(env), licenceCheck(env), checkStuckJobs(env), checkPaymentReminders(env), writeDigests(env)]).catch((error) => {
      console.error(error);
    }));
  },
};
