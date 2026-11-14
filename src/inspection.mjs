import { addMonths } from "./repeat.mjs";
import { validateTestSheet } from "./test-sheet.mjs";

export const INSPECTION_PRICE_DEFAULT = "6,000–8,000";
export const INSPECTION_PARTNER_LINE = "Inspection carried out by Nuru & Maji with our licensed partner.";

const YES_NO = new Set(["yes", "no"]);
const RESULTS = new Set(["satisfactory", "unsatisfactory"]);

function isoDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

export function defaultNextDue(inspectedOn) {
  return addMonths(inspectedOn, 12);
}

export function nairobiDate(seconds) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(seconds * 1000));
}

// The shared electrical readings use the test sheet ranges. They are a record, not a pass mark.
export function validateInspection(raw, today) {
  const sheet = validateTestSheet("electrical", {
    insulationMohm: raw.insulationMohm,
    zsOhm: raw.zsOhm,
    rcdMs: raw.rcdMs,
    polarity: raw.polarity,
    result: "pass",
    notes: "",
  });
  if (sheet.error) return { error: sheet.error };
  const visibleDamage = String(raw.visibleDamage || "");
  const overloaded = String(raw.overloaded || "");
  const result = String(raw.result || "");
  if (!YES_NO.has(visibleDamage)) return { error: "Choose whether visible damage was seen." };
  if (!YES_NO.has(overloaded)) return { error: "Choose whether circuits looked overloaded." };
  if (!RESULTS.has(result)) return { error: "Choose satisfactory or unsatisfactory." };
  const inspectedOn = isoDate(raw.inspectedOn) || isoDate(today);
  if (!inspectedOn) return { error: "Enter the inspection date." };
  const nextDue = isoDate(raw.nextDue) || defaultNextDue(inspectedOn);
  if (nextDue < inspectedOn) return { error: "The next inspection is due on or after this visit." };
  const recommendations = String(raw.recommendations || "").trim().slice(0, 1000);
  return {
    readings: {
      ...sheet.readings,
      visibleDamage,
      overloaded,
    },
    recommendations,
    result,
    inspectedOn,
    nextDue,
  };
}

export function inspectionPriceLine(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `From KES ${text}`;
}

export function parseInspectionSettings(input) {
  const price = String(input.price ?? "").trim().slice(0, 40);
  if (price && !/^[\d,\s–-]+$/.test(price)) {
    return { ok: false, error: "The price range can use numbers, commas, and a dash." };
  }
  const sms = input.sms === true || input.sms === "1" || input.sms === "on";
  return { ok: true, price, sms };
}

export function inspectionReminderDue({ today, nextDue, sentOn, smsOn, optedOut, hour }) {
  if (!smsOn || optedOut || sentOn) return false;
  if (hour < 8 || hour >= 19) return false;
  if (!nextDue || nextDue > today) return false;
  return true;
}

export function inspectionReminderText() {
  return "Nuru & Maji: the next electrical safety inspection is due. Sign in to book the visit.";
}

export function inspectionReportLines(input) {
  const readings = input.readings || {};
  const result = input.result === "satisfactory" ? "Satisfactory" : "Unsatisfactory";
  return [
    "Electrical safety inspection",
    input.address ? `Property: ${input.address}` : "Property: address not recorded",
    `Date: ${input.inspectedOn}`,
    `Inspector: ${input.inspectorName || "Not recorded"}`,
    `Insulation resistance: ${readings.insulationMohm} MΩ`,
    `Earthing, Zs: ${readings.zsOhm} Ω`,
    `RCD trip time: ${readings.rcdMs} ms`,
    `Polarity: ${readings.polarity}`,
    `Visible damage: ${readings.visibleDamage}`,
    `Overloaded circuits: ${readings.overloaded}`,
    `Overall result: ${result}`,
    `Next inspection due: ${input.nextDue}`,
    input.recommendations ? `Recommendations: ${input.recommendations}` : "Recommendations: none recorded.",
    INSPECTION_PARTNER_LINE,
  ];
}
