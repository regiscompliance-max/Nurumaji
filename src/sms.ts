import type { Bindings } from "./types";

export async function sendLoginCode(env: Bindings, phone: string, code: string): Promise<void> {
  if (env.OTP_DEV_MODE === "true") {
    console.log(`[OTP_DEV_MODE] ${phone} ${code}`);
    return;
  }
  if (!env.AT_API_KEY || !env.AT_USERNAME || !env.AT_SENDER_ID) {
    throw new Error("sms_not_configured");
  }
  const body = new URLSearchParams({
    username: env.AT_USERNAME,
    to: phone,
    message: `Your Nuru & Maji sign-in code is ${code}. It expires in 5 minutes.`,
    from: env.AT_SENDER_ID,
  });
  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey: env.AT_API_KEY,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) throw new Error("sms_failed");
}

export async function sendSms(env: Bindings, phone: string, message: string): Promise<void> {
  if (env.OTP_DEV_MODE === "true") {
    console.log("[SMS] message sent");
    return;
  }
  if (!env.AT_API_KEY || !env.AT_USERNAME || !env.AT_SENDER_ID) {
    console.error("SMS was not sent because Africa's Talking is not configured.");
    return;
  }
  const body = new URLSearchParams({
    username: env.AT_USERNAME,
    to: phone,
    message,
    from: env.AT_SENDER_ID,
  });
  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey: env.AT_API_KEY,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) console.error("SMS was not accepted by Africa's Talking.");
}
