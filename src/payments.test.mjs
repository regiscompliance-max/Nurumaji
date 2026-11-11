import assert from "node:assert/strict";
import test from "node:test";
import { daysPastDue, owedBucket, parsePaymentSettings, paymentReminderText, reminderToSend } from "./payments.mjs";

const at = (iso) => Math.floor(Date.parse(iso) / 1000);
const due = at("2026-11-04T15:00:00+03:00");
const offsets = [0, 3, 7];

function remind(iso, extra = {}) {
  return reminderToSend({
    now: at(iso),
    dueAt: due,
    status: "unpaid",
    paused: false,
    offsets,
    sentOffsets: [],
    ...extra,
  });
}

test("sends the due-date reminder inside the Nairobi window, once", () => {
  assert.equal(remind("2026-11-04T07:59:00+03:00"), null);
  assert.equal(remind("2026-11-04T08:00:00+03:00"), 0);
  assert.equal(remind("2026-11-04T18:59:00+03:00"), 0);
  assert.equal(remind("2026-11-04T19:00:00+03:00"), null);
  assert.equal(remind("2026-11-04T10:00:00+03:00", { sentOffsets: [0] }), null);
});

test("sends the later reminder and does not replay one that was missed", () => {
  assert.equal(remind("2026-11-07T09:00:00+03:00"), 3);
  assert.equal(remind("2026-11-07T09:00:00+03:00", { sentOffsets: [0] }), 3);
  assert.equal(remind("2026-11-07T09:00:00+03:00", { sentOffsets: [3] }), null);
  assert.equal(remind("2026-11-11T09:00:00+03:00", { sentOffsets: [0, 3] }), 7);
});

test("stops for a paid invoice, a pause, and a date that is not due yet", () => {
  assert.equal(remind("2026-11-08T09:00:00+03:00", { status: "paid" }), null);
  assert.equal(remind("2026-11-08T09:00:00+03:00", { paused: true }), null);
  assert.equal(remind("2026-11-03T09:00:00+03:00"), null);
  assert.equal(daysPastDue(due, at("2026-11-03T09:00:00+03:00")), -1);
});

test("groups amounts by how many days past the due date", () => {
  assert.equal(owedBucket(0), "0-7");
  assert.equal(owedBucket(7), "0-7");
  assert.equal(owedBucket(8), "8-30");
  assert.equal(owedBucket(31), "30+");
  assert.equal(owedBucket(-1), null);
});

test("keeps client texts off unless the offsets and the switch are valid", () => {
  const saved = parsePaymentSettings({ dueDays: "7", offsets: "0, 3, 7" });
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.sms, false);
    assert.deepEqual(saved.offsets, [0, 3, 7]);
  }
  const rejected = parsePaymentSettings({ dueDays: "7", offsets: "0,3,3" });
  assert.equal(rejected.ok, false);
  const text = paymentReminderText({ reference: "AB12CD34", amountKes: 4500, offsetDays: 3 });
  assert.equal(text.includes("KES 4,500"), true);
  assert.equal(text.includes("Payment through the site is not switched on."), true);
  assert.equal(/final|legal|court/i.test(text), false);
});
