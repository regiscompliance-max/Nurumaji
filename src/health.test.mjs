import assert from "node:assert/strict";
import test from "node:test";
import { healthSlot, healthWarning, parseAtBalance, redactSecret } from "./health.mjs";

test("checks once in each four-hour Nairobi block", () => {
  assert.equal(healthSlot("2026-11-11", 3), "2026-11-11-00");
  assert.equal(healthSlot("2026-11-11", 4), "2026-11-11-04");
  assert.equal(healthSlot("2026-11-11", 4), healthSlot("2026-11-11", 7));
});

test("reads a balance and warns below the threshold without keeping a secret", () => {
  assert.equal(parseAtBalance('{"UserData":{"balance":"KES 1,250.50"}}'), 1250.5);
  assert.equal(parseAtBalance("no balance"), null);
  assert.equal(healthWarning({ databaseOk: true, portalOk: true, balance: 40, threshold: 50 }), "The Africa's Talking balance is low.");
  assert.equal(healthWarning({ databaseOk: false, portalOk: true, balance: 80, threshold: 50 }), "A health check failed.");
  assert.equal(healthWarning({ databaseOk: true, portalOk: true, balance: 80, threshold: 50 }), null);
  assert.equal(redactSecret("key abc123 failed", "abc123"), "key [redacted] failed");
});
