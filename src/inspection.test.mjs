import assert from "node:assert/strict";
import test from "node:test";
import {
  INSPECTION_PARTNER_LINE,
  defaultNextDue,
  inspectionPriceLine,
  inspectionReminderDue,
  inspectionReminderText,
  inspectionReportLines,
  parseInspectionSettings,
  validateInspection,
} from "./inspection.mjs";

const readings = {
  insulationMohm: "50",
  zsOhm: "0.8",
  rcdMs: "28",
  polarity: "pass",
  visibleDamage: "no",
  overloaded: "no",
  result: "satisfactory",
  recommendations: "Replace the cracked socket in the kitchen.",
};

test("records an inspection and defaults the next visit to 12 months", () => {
  const saved = validateInspection({ ...readings, inspectedOn: "2026-11-14" }, "2026-11-14");
  assert.equal(saved.error, undefined);
  assert.equal(saved.nextDue, "2027-11-14");
  assert.equal(saved.readings.zsOhm, 0.8);
  assert.equal(defaultNextDue("2026-11-14"), "2027-11-14");
  assert.equal(validateInspection({ ...readings, insulationMohm: "9000" }, "2026-11-14").error, "Enter the electrical readings as numbers in range.");
  assert.equal(validateInspection({ ...readings, result: "pass" }, "2026-11-14").error, "Choose satisfactory or unsatisfactory.");
});

test("shows the saved range as a from price and keeps the reminder off", () => {
  assert.equal(inspectionPriceLine("6,000–8,000"), "From KES 6,000–8,000");
  assert.equal(inspectionPriceLine(""), "");
  const saved = parseInspectionSettings({ price: "6,000–8,000" });
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal(saved.sms, false);
  assert.equal(parseInspectionSettings({ price: "call us" }).ok, false);
  assert.equal(inspectionReminderDue({
    today: "2027-11-14",
    nextDue: "2027-11-14",
    sentOn: null,
    smsOn: false,
    optedOut: false,
    hour: 10,
  }), false);
  assert.equal(inspectionReminderDue({
    today: "2027-11-14",
    nextDue: "2027-11-14",
    sentOn: null,
    smsOn: true,
    optedOut: false,
    hour: 10,
  }), true);
  assert.equal(inspectionReminderDue({
    today: "2027-11-14",
    nextDue: "2027-11-14",
    sentOn: "2027-11-14",
    smsOn: true,
    optedOut: false,
    hour: 10,
  }), false);
  const text = inspectionReminderText();
  assert.equal(/KES|certificate|certified/i.test(text), false);
});

test("the report names the licensed partner and is not a government certificate", () => {
  const lines = inspectionReportLines({
    address: "Westlands",
    inspectedOn: "2026-11-14",
    inspectorName: "Amina",
    readings: { insulationMohm: 50, zsOhm: 0.8, rcdMs: 28, polarity: "pass", visibleDamage: "no", overloaded: "no" },
    result: "satisfactory",
    nextDue: "2027-11-14",
    recommendations: "Replace the cracked socket in the kitchen.",
  });
  const text = lines.join("\n");
  assert.equal(lines.at(-1), INSPECTION_PARTNER_LINE);
  assert.equal(text.includes("Electrical safety inspection"), true);
  assert.equal(text.includes("Property: Westlands"), true);
  assert.equal(/government certificate|certified|nuru & maji is licensed/i.test(text), false);
});
