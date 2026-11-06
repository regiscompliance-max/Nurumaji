import assert from "node:assert/strict";
import test from "node:test";
import { haversineKm, offerSlots, rankCandidates, shouldFlag } from "./dispatch.mjs";

test("haversine is zero at the same point and about 1km nearby", () => {
  assert.equal(haversineKm(-1.2921, 36.8219, -1.2921, 36.8219), 0);
  const nearby = haversineKm(-1.2921, 36.8219, -1.301, 36.8219);
  assert.ok(nearby > 0.8 && nearby < 1.2, String(nearby));
});

test("ranks by distance, then higher rating", () => {
  const ranked = rankCandidates([
    { userId: "b", distanceKm: 2, ratingAvg: 5 },
    { userId: "a", distanceKm: 2, ratingAvg: 4 },
    { userId: "c", distanceKm: 1, ratingAvg: 1 },
  ]);
  assert.deepEqual(ranked.map((item) => item.userId), ["c", "b", "a"]);
});

test("offers one at a time, or three at once for an emergency", () => {
  assert.equal(offerSlots({ urgency: "standard", existingOffers: 0, openOffers: 0 }), 1);
  assert.equal(offerSlots({ urgency: "urgent", existingOffers: 1, openOffers: 1 }), 0);
  assert.equal(offerSlots({ urgency: "urgent", existingOffers: 1, openOffers: 0 }), 1);
  assert.equal(offerSlots({ urgency: "emergency", existingOffers: 0, openOffers: 0 }), 3);
  assert.equal(offerSlots({ urgency: "standard", existingOffers: 3, openOffers: 0 }), 0);
});

test("flags when three offers are used or nobody is left", () => {
  assert.equal(shouldFlag({ existingOffers: 1, openOffers: 1, remainingCandidates: 4 }), false);
  assert.equal(shouldFlag({ existingOffers: 3, openOffers: 0, remainingCandidates: 2 }), true);
  assert.equal(shouldFlag({ existingOffers: 0, openOffers: 0, remainingCandidates: 0 }), true);
});
