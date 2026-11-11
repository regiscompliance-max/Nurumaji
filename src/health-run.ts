import { healthSlot, healthWarning, parseAtBalance, redactSecret } from "./health.mjs";
import { nairobiParts } from "./payments.mjs";
import { sendSms } from "./sms";
import type { Bindings } from "./types";

async function readBalance(env: Bindings): Promise<{ balance: number | null; detail: string }> {
  if (!env.AT_API_KEY || !env.AT_USERNAME) return { balance: null, detail: "Africa's Talking is not configured." };
  const host = env.AT_USERNAME === "sandbox" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  try {
    const response = await fetch(`${host}/version1/user?username=${encodeURIComponent(env.AT_USERNAME)}`, {
      headers: { apiKey: env.AT_API_KEY, Accept: "application/json" },
    });
    const text = redactSecret(await response.text(), env.AT_API_KEY);
    if (!response.ok) return { balance: null, detail: `Africa's Talking balance was not readable (HTTP ${response.status}).` };
    const balance = parseAtBalance(text);
    return { balance, detail: balance == null ? "Africa's Talking did not include a balance." : "Balance read." };
  } catch {
    return { balance: null, detail: "Africa's Talking balance was not readable." };
  }
}

export async function healthCheck(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const parts = nairobiParts(now);
  const slot = healthSlot(parts.date, parts.hour);
  let seen: { value: string } | null = null;
  try {
    seen = await env.DB.prepare("SELECT value FROM settings WHERE key = 'health_check_slot'").first<{ value: string }>();
  } catch {
    return;
  }
  if (seen?.value === slot) return;
  let databaseOk = false;
  try {
    await env.DB.prepare("SELECT 1 AS n").first();
    databaseOk = true;
  } catch { databaseOk = false; }
  const origin = env.APP_URL?.trim().replace(/\/$/, "");
  let portalOk = false;
  let portalDetail = "APP_URL is not set.";
  if (origin) {
    try {
      const response = await fetch(`${origin}/api/health`);
      portalOk = response.ok;
      portalDetail = portalOk ? "Portal health responded." : `Portal health returned HTTP ${response.status}.`;
    } catch {
      portalDetail = "Portal health did not respond.";
    }
  }
  const balance = await readBalance(env);
  const thresholdRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'at_balance_min_kes'").first<{ value: string }>();
  const threshold = Number(thresholdRow?.value);
  const limit = Number.isFinite(threshold) && threshold > 0 ? threshold : 50;
  const warning = healthWarning({ databaseOk, portalOk, balance: balance.balance, threshold: limit });
  const detail = [portalDetail, balance.detail, warning || "No warning."].join(" ");
  try {
    await env.DB.prepare(
      `INSERT INTO health_checks (id, checked_at, slot, database_ok, portal_ok, balance_kes, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), now, slot, databaseOk ? 1 : 0, portalOk ? 1 : 0, balance.balance, detail).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return;
    throw error;
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('health_check_slot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(slot).run();
  const smsOn = (await env.DB.prepare("SELECT value FROM settings WHERE key = 'health_sms'").first<{ value: string }>())?.value === "1";
  if (!warning || !smsOn) return;
  const admins = await env.DB.prepare("SELECT phone FROM users WHERE role = 'admin' AND status = 'active'").all<{ phone: string }>();
  for (const admin of admins.results ?? []) await sendSms(env, admin.phone, `Nuru & Maji: ${warning}`);
}
