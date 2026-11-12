import { maskPhone } from "./sms-delivery.mjs";
import type { Bindings } from "./types";
import { deliverWhatsAppOtp, whatsAppTemplateName } from "./whatsapp.mjs";

async function templateName(env: Bindings): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'whatsapp_otp_template'").first<{ value: string }>();
    return whatsAppTemplateName(row?.value);
  } catch {
    return whatsAppTemplateName(undefined);
  }
}

async function rememberFailure(env: Bindings, status: string, phone: string): Promise<void> {
  const now = String(Math.floor(Date.now() / 1000));
  const safeStatus = status.split(env.WA_TOKEN || "\0").join("[redacted]").slice(0, 120);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('wa_last_failure_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('wa_last_failure_status', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(safeStatus),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('wa_last_failure_phone', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(maskPhone(phone)),
    ]);
  } catch {
    console.error("The WhatsApp failure could not be stored.");
  }
}

export async function sendWhatsAppCode(env: Bindings, phone: string, code: string): Promise<void> {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) {
    await rememberFailure(env, "not configured", phone);
    throw new Error("wa_not_configured");
  }
  const template = await templateName(env);
  const result = await deliverWhatsAppOtp({
    fetchImpl: (url, init) => fetch(url, init),
    token: env.WA_TOKEN,
    phoneId: env.WA_PHONE_ID,
    to: phone,
    code,
    template,
  });
  if (result.ok) return;
  const status = result.status.split(env.WA_TOKEN).join("[redacted]");
  console.error(`WhatsApp login code was not delivered: ${status} phone ${maskPhone(phone)}`);
  await rememberFailure(env, status, phone);
  throw new Error("wa_failed");
}

export async function whatsAppLoginEnabled(env: Bindings): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'whatsapp_otp'").first<{ value: string }>();
    return row?.value === "1";
  } catch {
    return false;
  }
}
