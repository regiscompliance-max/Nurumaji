import assert from "node:assert/strict";
import test from "node:test";
import { followUpKind, followUpText, isDue, shouldTextClient } from "./repeat.mjs";

test("picks an annual electrical check and a water-heater service", () => {
  assert.equal(followUpKind("electrical", "Kitchen sockets"), "electrical_check");
  assert.equal(followUpKind("plumbing", "The water heater is cold"), "water_heater");
  assert.equal(followUpKind("plumbing", "A dripping tap"), null);
  assert.equal(isDue("2025-11-11", "2026-11-11", 12), true);
  assert.equal(isDue("2025-12-01", "2026-11-11", 12), false);
});

test("texts only when the switch is on and the client has not opted out", () => {
  assert.equal(shouldTextClient(false, false), false);
  assert.equal(shouldTextClient(true, true), false);
  assert.equal(shouldTextClient(true, false), true);
  const text = followUpText("electrical_check");
  assert.equal(text.includes("with our licensed partner"), true);
  assert.equal(/nurumaji is licensed|nurumaji is certified/i.test(text), false);
});
