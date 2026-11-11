import { failureLogLine, maskPhone, readSmsDelivery } from "./sms-delivery.mjs";
import type { Bindings } from "./types";

const LIVE_URL = "https://api.africastalking.com/version1/messaging";
const SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging";

// Sandbox accounts use the sandbox host and must not send a sender id.
// Live accounts send `from` only when AT_SENDER_ID is set.
export async function postAfricaSms(env: Bindings, phone: string, message: string): Promise<Response> {
  if (!env.AT_API_KEY || !env.AT_USERNAME) throw new Error("sms_not_configured");
  const body = new URLSearchParams({
    username: env.AT_USERNAME,
    to: phone,
    message,
  });
  if (env.AT_SENDER_ID && env.AT_USERNAME !== "sandbox") body.set("from", env.AT_SENDER_ID);
  return fetch(env.AT_USERNAME === "sandbox" ? SANDBOX_URL : LIVE_URL, {
    method: "POST",
    headers: {
      apiKey: env.AT_API_KEY,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function rememberFailure(env: Bindings, status: string, statusCode: number | null, phone: string): Promise<void> {
  const now = String(Math.floor(Date.now() / 1000));
  const code = statusCode == null ? "" : String(statusCode);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('sms_last_failure_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('sms_last_failure_status', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(status.slice(0, 80)),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('sms_last_failure_code', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(code),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('sms_last_failure_phone', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(phone),
    ]);
  } catch {
    console.error("The SMS failure could not be stored.");
  }
}

async function deliveryOf(env: Bindings, response: Response) {
  const body = await response.text();
  const safe = env.AT_API_KEY ? body.split(env.AT_API_KEY).join("[redacted]") : body;
  return readSmsDelivery(response.status, safe);
}

export async function sendLoginCode(env: Bindings, phone: string, code: string): Promise<void> {
  if (env.OTP_DEV_MODE === "true") {
    console.log(`[OTP_DEV_MODE] ${phone} ${code}`);
    return;
  }
  const response = await postAfricaSms(env, phone, `Your Nuru & Maji sign-in code is ${code}. It expires in 5 minutes.`);
  const delivery = await deliveryOf(env, response);
  if (delivery.ok) return;
  console.error(failureLogLine({ ...delivery, phone }));
  await rememberFailure(env, delivery.status, delivery.statusCode, maskPhone(phone));
  throw new Error(delivery.httpStatus >= 200 && delivery.httpStatus < 300 ? "sms_rejected" : "sms_failed");
}

export async function sendSms(env: Bindings, phone: string, message: string): Promise<void> {
  if (env.OTP_DEV_MODE === "true") {
    console.log("[SMS] message sent");
    return;
  }
  if (!env.AT_API_KEY || !env.AT_USERNAME) {
    console.error("SMS was not sent because Africa's Talking is not configured.");
    return;
  }
  const response = await postAfricaSms(env, phone, message);
  const delivery = await deliveryOf(env, response);
  if (delivery.ok) return;
  console.error(failureLogLine({ ...delivery, phone }));
  await rememberFailure(env, delivery.status, delivery.statusCode, maskPhone(phone));
}
