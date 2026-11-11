import assert from "node:assert/strict";
import test from "node:test";
import { validateTestSheet } from "./test-sheet.mjs";

test("accepts an electrical test sheet and rejects a reading outside range", () => {
  const ok = validateTestSheet("electrical", {
    insulationMohm: "50",
    zsOhm: "0.8",
    rcdMs: "28",
    polarity: "pass",
    result: "pass",
    notes: "Recorded on site.",
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.readings.insulationMohm, 50);
  assert.equal(validateTestSheet("electrical", {
    insulationMohm: "9000", zsOhm: "1", rcdMs: "20", polarity: "pass", result: "fail",
  }).error, "Enter the electrical readings as numbers in range.");
});

test("accepts a plumbing test sheet", () => {
  const ok = validateTestSheet("plumbing", {
    pressureBar: "4.5",
    durationMin: "15",
    leakCheck: "pass",
    result: "pass",
  });
  assert.equal(ok.readings.durationMin, 15);
  assert.equal(ok.result, "pass");
});
