import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { nowSeconds, randomToken, sha256 } from "./crypto";
import type { AppContext, UserRow } from "./types";

export const SESSION_COOKIE = "nm_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function readSession(c: Context<AppContext>): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.DB) return null;
  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT users.id, users.phone, users.name, users.role, users.status, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.status = 'active'`
  )
    .bind(tokenHash, nowSeconds())
    .first<UserRow>();
  return row ?? null;
}

export async function startSession(c: Context<AppContext>, userId: string): Promise<void> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = nowSeconds();
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), userId, tokenHash, now + THIRTY_DAYS, now)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function endSession(c: Context<AppContext>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && c.env.DB) {
    const tokenHash = await sha256(token);
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, sameSite: "Lax" });
}
