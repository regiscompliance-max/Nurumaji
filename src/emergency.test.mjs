import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingWindow,
  dispatchRank,
  emergencyAlertText,
  emergencyNotice,
  emergencyProblem,
  emergencySettingsFromStore,
  parseEmergencySettings,
  safetyLine,
} from "./emergency.mjs";

const at = (iso) => Math.floor(Date.parse(iso) / 1000);

const proposed = {
  minKes: 4000,
  nightPercent: 50,
  weekendPercent: 25,
  targetHours: 2,
  showTarget: false,
  servicesNumber: "",
};

test("keeps emergency bookings and the client response promise off by default", () => {
  const saved = parseEmergencySettings({
    minKes: "4000",
    nightPercent: "50",
    weekendPercent: "25",
    targetHours: "2",
  });
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.bookings, false);
    assert.equal(saved.showTarget, false);
    assert.equal(saved.alert, false);
    assert.equal(saved.servicesNumber, "");
  }
  const stored = emergencySettingsFromStore({});
  assert.equal(stored.bookings, false);
  assert.equal(stored.minKes, 4000);
  assert.equal(parseEmergencySettings({ minKes: "4,000", nightPercent: "50", weekendPercent: "25", targetHours: "2" }).ok, false);
});

test("shows proposed charges and no response time unless an admin switches that on", () => {
  const day = emergencyNotice(proposed, at("2026-11-14T10:00:00+03:00"));
  const text = day.join(" ");
  assert.equal(text.includes("Proposed charges"), true);
  assert.equal(text.includes("KES 4,000"), true);
  assert.equal(text.includes("50%"), true);
  assert.equal(text.includes("25%"), true);
  assert.equal(/response target|hours/i.test(text), false);
  assert.equal(text.includes("weekend window"), true);
  assert.equal(bookingWindow(at("2026-11-14T20:00:00+03:00")).night, true);
  const shown = emergencyNotice({ ...proposed, showTarget: true }, at("2026-11-14T10:00:00+03:00"));
  assert.equal(shown.some((line) => line === "Response target: 2 hours."), true);
});

test("the safety line has no phone number until one is saved", () => {
  const plain = safetyLine("");
  assert.equal(/\d/.test(plain), false);
  assert.equal(plain.includes("call emergency services"), true);
  assert.equal(safetyLine("100").includes("Call 100."), true);
  const alert = emergencyAlertText(2);
  assert.equal(/licensed|certified/i.test(alert), false);
  assert.equal(emergencyProblem("power")?.trade, "electrical");
  assert.equal(emergencyProblem("nope"), null);
  assert.equal(dispatchRank("emergency"), 0);
  assert.equal(dispatchRank("urgent") > dispatchRank("emergency"), true);
});
