import assert from "node:assert/strict";
import test from "node:test";
import { parseQuoteFollowUpSettings, quoteFollowUpDetail, quoteFollowUpDue, quoteFollowUpText } from "./quote-followups.mjs";

const at = (iso) => Math.floor(Date.parse(iso) / 1000);
const sentAt = at("2026-11-01T15:00:00+03:00");

function due(iso, extra = {}) {
  return quoteFollowUpDue({
    now: at(iso),
    sentAt,
    status: "sent",
    days: 3,
    finalDays: null,
    sentKinds: [],
    ...extra,
  });
}

test("sends one reminder after three Nairobi days, inside the daytime window", () => {
  assert.equal(due("2026-11-03T10:00:00+03:00"), null);
  assert.equal(due("2026-11-04T07:59:00+03:00"), null);
  assert.equal(due("2026-11-04T08:00:00+03:00"), "first");
  assert.equal(due("2026-11-04T18:59:00+03:00"), "first");
  assert.equal(due("2026-11-04T19:00:00+03:00"), null);
  assert.equal(due("2026-11-05T10:00:00+03:00", { sentKinds: ["first"] }), null);
});

test("skips a quote that was accepted or declined", () => {
  assert.equal(due("2026-11-06T10:00:00+03:00", { status: "approved" }), null);
  assert.equal(due("2026-11-06T10:00:00+03:00", { status: "rejected" }), null);
  assert.equal(due("2026-11-06T10:00:00+03:00", { status: "draft" }), null);
});

test("sends a last reminder only when that interval is set and the first one was sent", () => {
  assert.equal(due("2026-11-08T10:00:00+03:00", { finalDays: 7 }), "first");
  assert.equal(due("2026-11-08T10:00:00+03:00", { finalDays: 7, sentKinds: ["first"] }), "final");
  assert.equal(due("2026-11-08T10:00:00+03:00", { finalDays: 7, sentKinds: ["first", "final"] }), null);
  assert.equal(due("2026-11-06T10:00:00+03:00", { finalDays: 7, sentKinds: ["first"] }), null);
});

test("keeps the reminders off unless the intervals are valid", () => {
  const saved = parseQuoteFollowUpSettings({ days: "3", finalDays: "", sms: false });
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.sms, false);
    assert.equal(saved.days, 3);
    assert.equal(saved.finalDays, null);
  }
  assert.equal(parseQuoteFollowUpSettings({ days: "3", finalDays: "3" }).ok, false);
  assert.equal(parseQuoteFollowUpSettings({ days: "0", finalDays: "" }).ok, false);
  const text = quoteFollowUpText("first");
  const last = quoteFollowUpText("final");
  assert.equal(/KES|\d{3,}|licensed|certified/i.test(`${text} ${last}`), false);
  assert.equal(quoteFollowUpDetail("final"), "a last reminder");
});
