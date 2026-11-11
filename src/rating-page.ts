import { nowSeconds, sha256 } from "./crypto";
import { canEditRating } from "./ratings.mjs";
import { saveJobRating } from "./rating-run";
import type { Bindings } from "./types";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-KE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${title} | Nuru &amp; Maji</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css?v=20261111e">
<link rel="stylesheet" href="/assets/portal.css?v=20261111e">
</head>
<body>
<header class="site-head"><div class="wrap">
  <a class="brand" href="/"><img src="/assets/logo-lockup.svg" width="222" height="52" alt="Nuru &amp; Maji"></a>
</div></header>
<main class="band"><div class="wrap portal-dash">${body}</div></main>
</body></html>`;
}

type Invite = {
  job_id: string;
  client_id: string;
  trade: string;
  expires_at: number;
  score: number | null;
  comment: string | null;
  rated_at: number | null;
};

async function loadInvite(env: Bindings, token: string): Promise<Invite | null> {
  return env.DB.prepare(
    `SELECT rating_invites.job_id, rating_invites.expires_at, jobs.client_id, jobs.trade,
            ratings.score, ratings.comment, ratings.created_at AS rated_at
     FROM rating_invites
     JOIN jobs ON jobs.id = rating_invites.job_id
     LEFT JOIN ratings ON ratings.job_id = jobs.id
     WHERE rating_invites.token_hash = ?`
  ).bind(await sha256(token)).first<Invite>();
}

function stars(selected: number | null): string {
  return [5, 4, 3, 2, 1].map((score) =>
    `<label class="trade-choice"><input type="radio" name="score" value="${score}"${selected === score ? " checked" : ""} required> ${score}</label>`
  ).join("");
}

export async function ratingGet(env: Bindings, token: string): Promise<Response> {
  const invite = await loadInvite(env, token).catch(() => null);
  const now = nowSeconds();
  if (!invite || invite.expires_at < now) return new Response(page("Link expired", "<h1>This link has expired</h1><p>Sign in to the portal if you still want to leave a rating.</p>"), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const editable = invite.score == null || canEditRating(invite.rated_at, now);
  const body = editable
    ? `<p class="eyebrow">Rating</p><h1>How was the visit?</h1>
       <p>This is for the ${escapeHtml(invite.trade)} visit. The rating is private to Nuru &amp; Maji.</p>
       <form method="post" action="/rate/${encodeURIComponent(token)}" class="form rate-form">
         <fieldset class="test-sheet"><legend>Stars, from 1 to 5</legend>${stars(invite.score)}</fieldset>
         <div class="field"><label for="comment">Comment, optional</label><textarea id="comment" name="comment" maxlength="500">${escapeHtml(invite.comment || "")}</textarea></div>
         <button class="btn btn-amber" type="submit">${invite.score == null ? "Save rating" : "Update rating"}</button>
       </form>`
    : `<h1>Rating saved</h1><p>You rated this visit ${invite.score} out of 5.</p>${invite.comment ? `<p>${escapeHtml(invite.comment)}</p>` : ""}`;
  return new Response(page("Rate your visit", body), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function ratingPost(env: Bindings, token: string, raw: Record<string, unknown>): Promise<Response> {
  const invite = await loadInvite(env, token).catch(() => null);
  const now = nowSeconds();
  if (!invite || invite.expires_at < now) return new Response(page("Link expired", "<h1>This link has expired</h1>"), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const saved = await saveJobRating(env, {
    jobId: invite.job_id,
    clientId: invite.client_id,
    score: Number(raw.score),
    comment: String(raw.comment || ""),
    now,
  });
  if (saved.error) return new Response(page("Rating", `<h1>Rating</h1><p>${escapeHtml(saved.error)}</p>`), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
  return new Response(null, { status: 303, headers: { location: `/rate/${encodeURIComponent(token)}` } });
}
