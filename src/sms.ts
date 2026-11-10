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

export async function sendLoginCode(env: Bindings, phone: string, code: string): Promise<void> {
  if (env.OTP_DEV_MODE === "true") {
    console.log(`[OTP_DEV_MODE] ${phone} ${code}`);
    return;
  }
  const response = await postAfricaSms(env, phone, `Your Nuru & Maji sign-in code is ${code}. It expires in 5 minutes.`);
  if (!response.ok) {
    const text = await response.text();
    const safe = env.AT_API_KEY ? text.replaceAll(env.AT_API_KEY, "[redacted]") : text;
    console.error(`Africa's Talking login SMS failed: HTTP ${response.status} ${safe}`);
    throw new Error("sms_failed");
  }
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
  if (!response.ok) console.error("SMS was not accepted by Africa's Talking.");
}
