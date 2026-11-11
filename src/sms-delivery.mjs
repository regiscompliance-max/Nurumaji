const ACCEPTED = new Set([100, 101, 102]);

export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const last = digits.slice(-3);
  return last ? `***${last}` : "***";
}

export function readSmsDelivery(httpStatus, bodyText) {
  let payload = null;
  try { payload = JSON.parse(bodyText); } catch { payload = null; }
  const recipients = payload && payload.SMSMessageData && Array.isArray(payload.SMSMessageData.Recipients)
    ? payload.SMSMessageData.Recipients
    : [];
  const recipient = recipients[0] || null;
  const statusCode = recipient == null ? null : Number(recipient.statusCode);
  const code = Number.isFinite(statusCode) ? statusCode : null;
  const status = recipient ? String(recipient.status || "Unknown") : (httpStatus >= 200 && httpStatus < 300 ? "NoRecipient" : "HttpError");
  const accepted = httpStatus >= 200 && httpStatus < 300 && recipients.length > 0
    && recipients.every((item) => ACCEPTED.has(Number(item.statusCode)));
  return { ok: accepted, status, statusCode: code, httpStatus };
}

export function failureLogLine({ status, statusCode, phone }) {
  return `Africa's Talking SMS was not delivered: ${status} ${statusCode ?? "none"} phone ${maskPhone(phone)}`;
}

export function loginSmsError(reason) {
  if (reason === "sms_not_configured") return "Text messages are not configured yet.";
  if (reason === "sms_rejected") return "We couldn't send a code to that number. Check it and try again, or WhatsApp us on 0181 969 005.";
  return "The code could not be sent. Try again shortly.";
}
