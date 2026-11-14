import assert from "node:assert/strict";
import test from "node:test";
import {
  canCloseJob,
  canMarkForMarketing,
  closeReportText,
  parseReportSettings,
  photoKind,
  reportSettingsFromStore,
  warrantyLine,
  withinPhotoLimit,
} from "./job-report.mjs";

test("lets a job close without photos until an admin requires them", () => {
  assert.equal(canCloseJob({ required: false, beforeCount: 0, afterCount: 0 }).ok, true);
  assert.equal(canCloseJob({ required: true, beforeCount: 1, afterCount: 0 }).ok, false);
  assert.equal(canCloseJob({ required: true, beforeCount: 1, afterCount: 1 }).ok, true);
  const saved = parseReportSettings({ repairDays: "90", installMonths: "12" });
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.photosRequired, false);
    assert.equal(saved.sms, false);
  }
  assert.equal(reportSettingsFromStore({}).sms, false);
});

test("marketing needs the client's agreement, which starts unchecked", () => {
  assert.equal(canMarkForMarketing({ consent: false, requested: true }).ok, false);
  const kept = canMarkForMarketing({ consent: true, requested: true });
  assert.equal(kept.ok, true);
  if (kept.ok) assert.equal(kept.value, 1);
  const cleared = canMarkForMarketing({ consent: false, requested: false });
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.value, 0);
  assert.equal(photoKind("before"), "before");
  assert.equal(photoKind("poster"), "attachment");
  assert.equal(withinPhotoLimit(3, 2).ok, false);
});

test("the report line uses the saved cover periods and does not call the company licensed", () => {
  const line = warrantyLine(90, 12);
  assert.equal(line.includes("90 days"), true);
  assert.equal(line.includes("12 months"), true);
  assert.equal(/licensed|certified/i.test(line), false);
  const text = closeReportText("https://nurumaji.co.ke/portal/jobs/abc/report");
  assert.equal(text.includes("/portal/jobs/abc/report"), true);
  assert.equal(/KES|licensed/i.test(text), false);
});
