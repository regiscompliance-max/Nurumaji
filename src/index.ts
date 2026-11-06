import { Hono } from "hono";
import { api } from "./api";
import { portal } from "./portal";
import type { AppContext } from "./types";

const app = new Hono<AppContext>();

app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  const https = new URL(c.req.url).protocol === "https:";
  if (https) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'"
  );
});

app.route("/api", api);
app.route("/portal", portal);

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Something went wrong." }, 500);
});

export default app;
