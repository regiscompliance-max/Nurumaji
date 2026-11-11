export function followUpKind(trade, description) {
  const text = String(description || "").toLowerCase();
  if (trade === "electrical") return "electrical_check";
  if (trade === "plumbing" && /water heater|geyser/.test(text)) return "water_heater";
  return null;
}

export function addMonths(iso, months) {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, day));
  const pad = (value) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function isDue(completedOn, today, months) {
  return addMonths(completedOn, months) <= today;
}

export function shouldTextClient(smsOn, optedOut) {
  return Boolean(smsOn) && !optedOut;
}

export function followUpText(kind) {
  if (kind === "water_heater") {
    return "Nuru & Maji: it has been a year since the water heater visit. You can book servicing with our licensed partner in the portal.";
  }
  return "Nuru & Maji: it has been a year since your electrical visit. You can book a safety check with our licensed partner in the portal.";
}
