import assert from "node:assert/strict";
import test from "node:test";
import { preferOriginalTechnician, returnVisitDescription } from "./followups.mjs";

const tech = (userId, distanceKm) => ({ userId, distanceKm, ratingAvg: 0 });

test("offers the original technician first when they are on the eligible list", () => {
  const ranked = [tech("near", 1), tech("original", 4), tech("far", 6)];
  const next = preferOriginalTechnician(ranked, "original");
  assert.deepEqual(next.map((row) => row.userId), ["original", "near", "far"]);
  assert.deepEqual(ranked.map((row) => row.userId), ["near", "original", "far"]);
});

test("leaves the ranking unchanged when the original technician is not eligible", () => {
  const ranked = [tech("near", 1), tech("far", 6)];
  assert.deepEqual(preferOriginalTechnician(ranked, "original"), ranked);
  assert.deepEqual(preferOriginalTechnician(ranked, null), ranked);
  assert.equal(preferOriginalTechnician(ranked, "near")[0].userId, "near");
});

test("writes the recorded readings into the return visit", () => {
  const text = returnVisitDescription({ insulationMohm: 0.2, polarity: "fail" }, "Socket stayed dead.");
  assert.equal(text.includes("Follow-up visit."), true);
  assert.equal(text.includes("Insulation resistance, MΩ: 0.2"), true);
  assert.equal(text.includes("Notes: Socket stayed dead."), true);
  assert.equal(/certified|licensed|unsafe|non-compliant/i.test(text), false);
});
