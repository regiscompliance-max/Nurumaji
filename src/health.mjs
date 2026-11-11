export function healthSlot(date, hour) {
  return `${date}-${String(Math.floor(hour / 4) * 4).padStart(2, "0")}`;
}

export function parseAtBalance(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  const match = text.match(/KES\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function healthWarning({ databaseOk, portalOk, balance, threshold }) {
  if (!databaseOk || !portalOk) return "A health check failed.";
  if (balance != null && balance < threshold) return "The Africa's Talking balance is low.";
  return null;
}

export function redactSecret(text, secret) {
  if (!secret) return text;
  return String(text).split(secret).join("[redacted]");
}
