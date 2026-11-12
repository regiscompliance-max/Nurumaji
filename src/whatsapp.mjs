const DEFAULT_TEMPLATE = "nurumaji_login_code";

export function whatsAppTemplateName(value) {
  const name = String(value || "").trim();
  return /^[a-z0-9_]{1,64}$/.test(name) ? name : DEFAULT_TEMPLATE;
}

export function whatsAppOtpPayload(to, code, templateName) {
  const otp = String(code);
  return {
    messaging_product: "whatsapp",
    to: String(to).replace(/^\+/, ""),
    type: "template",
    template: {
      name: whatsAppTemplateName(templateName),
      language: { code: "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: otp }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },
      ],
    },
  };
}

export function readWhatsAppDelivery(httpStatus, bodyText) {
  let payload = null;
  try { payload = JSON.parse(bodyText); } catch { payload = null; }
  const id = payload && payload.messages && payload.messages[0] ? payload.messages[0].id : "";
  const error = payload && payload.error ? payload.error : null;
  const status = error
    ? String(error.message || error.type || "Error").slice(0, 120)
    : (typeof id === "string" && id ? "sent" : "NoMessageId");
  const ok = httpStatus >= 200 && httpStatus < 300 && typeof id === "string" && id.length > 0;
  return { ok, status, httpStatus };
}

export async function deliverWhatsAppOtp({ fetchImpl, token, phoneId, to, code, template }) {
  const response = await fetchImpl(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(whatsAppOtpPayload(to, code, template)),
  });
  const raw = await response.text();
  const safe = token ? raw.split(token).join("[redacted]") : raw;
  return readWhatsAppDelivery(response.status, safe);
}
