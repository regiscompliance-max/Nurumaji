import assert from "node:assert/strict";
import test from "node:test";
import { canEditRating, rankingScore, ratingInviteDue, UNRATED_RANKING_SCORE } from "./ratings.mjs";

test("ranks an unrated technician as a neutral 4 so they are not last", () => {
  assert.equal(rankingScore(0, 0), UNRATED_RANKING_SCORE);
  assert.equal(rankingScore(null, null), 4);
  assert.equal(rankingScore(5, 3), 5);
  assert.equal(rankingScore(2.5, 2), 2.5);
});

test("allows a rating change for 24 hours", () => {
  const now = 1_700_000_000;
  assert.equal(canEditRating(now - 60, now), true);
  assert.equal(canEditRating(now - 24 * 3600, now), true);
  assert.equal(canEditRating(now - 24 * 3600 - 1, now), false);
  assert.equal(canEditRating(null, now), false);
});

test("sends one rating text after the delay and only inside the Nairobi window", () => {
  const completedAt = 1_000_000;
  const due = { completedAt, delayHours: 2, alreadySent: false, alreadyRated: false };
  assert.equal(ratingInviteDue({ ...due, now: completedAt + 2 * 3600 - 1, hour: 10 }), false);
  assert.equal(ratingInviteDue({ ...due, now: completedAt + 2 * 3600, hour: 10 }), true);
  assert.equal(ratingInviteDue({ ...due, now: completedAt + 3 * 3600, hour: 7 }), false);
  assert.equal(ratingInviteDue({ ...due, now: completedAt + 3 * 3600, hour: 19 }), false);
  assert.equal(ratingInviteDue({ ...due, now: completedAt + 3 * 3600, hour: 9, alreadySent: true }), false);
  assert.equal(ratingInviteDue({ ...due, now: completedAt + 3 * 3600, hour: 9, alreadyRated: true }), false);
});
