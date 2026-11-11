import assert from "node:assert/strict";
import test from "node:test";
import { daysUntilExpiry, dispatchHold, reminderOffset } from "./compliance.mjs";

const today = "2026-11-11";

test("counts Nairobi days until a document expires", () => {
  assert.equal(daysUntilExpiry("2026-11-25", today), 14);
  assert.equal(daysUntilExpiry("2026-11-10", today), -1);
  assert.equal(reminderOffset(14), 14);
  assert.equal(reminderOffset(10), null);
});

test("holds dispatch when a required document is missing or expired", () => {
  const docs = [
    { docType: "id", expiryDate: "2027-01-01" },
    { docType: "insurance", expiryDate: "2026-11-01" },
    { docType: "licence", expiryDate: "2027-01-01" },
  ];
  assert.equal(dispatchHold(docs, today), "Insurance has expired");
  assert.equal(dispatchHold([
    { docType: "id", expiryDate: "2027-01-01" },
    { docType: "insurance", expiryDate: "2027-01-01" },
  ], today), "Licence is missing");
  assert.equal(dispatchHold([
    { docType: "id", expiryDate: "2027-01-01" },
    { docType: "insurance", expiryDate: "2027-01-01" },
    { docType: "certificate", expiryDate: "2027-06-01" },
  ], today), null);
});
