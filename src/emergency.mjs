import { nairobiParts } from "./payments.mjs";

export const EMERGENCY_DEFAULTS = {
  bookings: false,
  minKes: 4000,
  nightPercent: 50,
  weekendPercent: 25,
  targetHours: 2,
  showTarget: false,
  alert: false,
  servicesNumber: "",
  template: "nurumaji_emergency_alert",
};

export const EMERGENCY_PROBLEMS = {
  burst: { trade: "plumbing", label: "Burst pipe or major leak" },
  power: { trade: "electrical", label: "No power, burning smell, or sparking" },
  flood: { trade: "plumbing", label: "Flooding" },
  water: { trade: "plumbing", label: "No water" },
};

function wholeNumber(value, min, max) {
  const text = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function flag(value) {
  return value === true || value === "1" || value === "on";
}

export function parseEmergencySettings(input) {
  const minKes = wholeNumber(input.minKes, 1, 1_000_000);
  const nightPercent = wholeNumber(input.nightPercent, 0, 200);
  const weekendPercent = wholeNumber(input.weekendPercent, 0, 200);
  const targetHours = wholeNumber(input.targetHours, 1, 24);
  if (minKes == null) return { ok: false, error: "The emergency minimum must be a whole number of shillings." };
  if (nightPercent == null || weekendPercent == null) return { ok: false, error: "Surcharges must be whole percentages from 0 to 200." };
  if (targetHours == null) return { ok: false, error: "The response target must be a whole number of hours from 1 to 24." };
  const servicesNumber = String(input.servicesNumber ?? "").trim().slice(0, 20);
  if (servicesNumber && !/^[0-9+()\s-]{3,20}$/.test(servicesNumber)) {
    return { ok: false, error: "The emergency services number can use digits, spaces, and a plus sign." };
  }
  const template = String(input.template ?? "").trim();
  if (template && !/^[a-z0-9_]{1,64}$/.test(template)) {
    return { ok: false, error: "The template name can use lowercase letters, numbers, and underscores." };
  }
  return {
    ok: true,
    bookings: flag(input.bookings),
    minKes,
    nightPercent,
    weekendPercent,
    targetHours,
    showTarget: flag(input.showTarget),
    alert: flag(input.alert),
    servicesNumber,
    template: template || EMERGENCY_DEFAULTS.template,
  };
}

export function emergencySettingsFromStore(values) {
  const parsed = parseEmergencySettings({
    bookings: values.emergency_bookings === "1",
    minKes: values.emergency_min_kes ?? String(EMERGENCY_DEFAULTS.minKes),
    nightPercent: values.emergency_night_percent ?? String(EMERGENCY_DEFAULTS.nightPercent),
    weekendPercent: values.emergency_weekend_percent ?? String(EMERGENCY_DEFAULTS.weekendPercent),
    targetHours: values.emergency_target_hours ?? String(EMERGENCY_DEFAULTS.targetHours),
    showTarget: values.emergency_show_target === "1",
    alert: values.emergency_alert === "1",
    servicesNumber: values.emergency_services_number ?? "",
    template: values.whatsapp_emergency_template,
  });
  if (!parsed.ok) return { ...EMERGENCY_DEFAULTS };
  return parsed;
}

export function nairobiWeekday(seconds) {
  const date = nairobiParts(seconds).date;
  return new Date(`${date}T12:00:00+03:00`).getUTCDay();
}

export function bookingWindow(seconds) {
  const hour = nairobiParts(seconds).hour;
  const weekday = nairobiWeekday(seconds);
  return {
    night: hour < 8 || hour >= 19,
    weekend: weekday === 0 || weekday === 6,
  };
}

export function safetyLine(servicesNumber) {
  const base = "If you smell gas, see a fire, or a wire is live, leave and call emergency services before you book.";
  const number = String(servicesNumber || "").trim();
  return number ? `${base} Call ${number}.` : base;
}

export function emergencyNotice(settings, now) {
  const money = `KES ${Number(settings.minKes).toLocaleString("en-KE")}`;
  const window = bookingWindow(now);
  const lines = [
    "Proposed charges. An admin can change these before you are quoted.",
    `Emergency minimum call-out: ${money}.`,
    `Night surcharge: ${settings.nightPercent}%, from 19:00 to 08:00 Nairobi time.`,
    `Weekend and public holiday surcharge: ${settings.weekendPercent}%.`,
  ];
  if (window.night) lines.push("A booking at this time is in the night window.");
  if (window.weekend) lines.push("A booking on this day is in the weekend window.");
  if (settings.showTarget) lines.push(`Response target: ${settings.targetHours} hours.`);
  lines.push(safetyLine(settings.servicesNumber));
  return lines;
}

export function emergencyAlertText(targetHours) {
  return `Nuru & Maji: a new emergency booking is on the dispatch board. Response target: ${targetHours} hours.`;
}

export function dispatchRank(urgency) {
  return urgency === "emergency" ? 0 : 1;
}

export function emergencyProblem(key) {
  if (typeof key !== "string") return null;
  const found = EMERGENCY_PROBLEMS[key];
  return found ? { key, ...found } : null;
}
