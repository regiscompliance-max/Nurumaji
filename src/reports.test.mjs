import assert from "node:assert/strict";
import test from "node:test";
import { digestText, dueDigests, owedAt, reportWindow, shiftNairobiDate, snapshotMissing } from "./reports.mjs";

const at = (iso) => Math.floor(Date.parse(iso) / 1000);

test("uses Nairobi midnights for today, yesterday, and the last 7 days", () => {
  const now = at("2026-11-10T15:30:00+03:00");
  const today = reportWindow("today", now);
  assert.equal(today.start, at("2026-11-10T00:00:00+03:00"));
  assert.equal(today.end, now);
  const yesterday = reportWindow("yesterday", now);
  assert.equal(yesterday.start, at("2026-11-09T00:00:00+03:00"));
  assert.equal(yesterday.end, at("2026-11-10T00:00:00+03:00"));
  const week = reportWindow("days7", now);
  assert.equal(week.start, at("2026-11-04T00:00:00+03:00"));
  assert.equal(week.end, now);
  assert.equal(shiftNairobiDate("2026-03-01", -1), "2026-02-28");
});

test("writes yesterday at 07:00 Nairobi, and the previous week only on Monday", () => {
  assert.deepEqual(dueDigests(at("2026-11-10T06:59:00+03:00")), []);
  assert.deepEqual(dueDigests(at("2026-11-10T08:00:00+03:00")), []);
  const tuesday = dueDigests(at("2026-11-10T07:10:00+03:00"));
  assert.equal(tuesday.length, 1);
  assert.equal(tuesday[0].period, "day");
  assert.equal(tuesday[0].label, "2026-11-09");
  assert.equal(tuesday[0].start, at("2026-11-09T00:00:00+03:00"));
  const monday = dueDigests(at("2026-11-09T07:00:00+03:00"));
  assert.equal(monday.length, 2);
  assert.equal(monday[1].period, "week");
  assert.equal(monday[1].label, "2026-11-02 to 2026-11-08");
  assert.equal(monday[1].start, at("2026-11-02T00:00:00+03:00"));
  assert.equal(monday[1].end, at("2026-11-09T00:00:00+03:00"));
});

test("saves each period once", () => {
  const start = at("2026-11-09T00:00:00+03:00");
  assert.equal(snapshotMissing([start], start), false);
  assert.equal(snapshotMissing([start], start + 86400), true);
  assert.equal(snapshotMissing([], start), true);
});

test("counts money still owed at the end of the window, not money already paid", () => {
  const end = at("2026-11-10T00:00:00+03:00");
  const totals = owedAt([
    { status: "unpaid", issuedAt: at("2026-11-01T10:00:00+03:00"), paidAt: null, dueAt: at("2026-11-05T10:00:00+03:00"), amountKes: 8000 },
    { status: "paid", issuedAt: at("2026-11-01T10:00:00+03:00"), paidAt: at("2026-11-09T18:00:00+03:00"), dueAt: at("2026-11-08T10:00:00+03:00"), amountKes: 2000 },
    { status: "unpaid", issuedAt: at("2026-11-10T09:00:00+03:00"), paidAt: null, dueAt: at("2026-11-17T09:00:00+03:00"), amountKes: 500 },
  ], end);
  assert.equal(totals.owedKes, 8000);
  assert.equal(totals.overdueKes, 8000);
});

test("builds one short summary from the figures it is given", () => {
  const text = digestText("day", { booked: 5, completed: 3, collectedTotal: 12000, overdueKes: 8000, stuckOpen: 1 });
  assert.equal(text, "Nuru & Maji yesterday: 5 booked, 3 done, KES 12,000 collected, KES 8,000 overdue, 1 stuck.");
  assert.equal(/licensed|certified/i.test(text), false);
});
