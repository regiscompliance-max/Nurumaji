import assert from "node:assert/strict";
import test from "node:test";
import { classifyStuck, formatAge, isNewEpisode, parseStuckSettings, stuckAlertSms, thresholdsFromSettings } from "./stuck-jobs.mjs";

const thresholds = { awaitingMinutes: 30, notStartedHours: 4, inProgressHours: 8 };
const now = 1_700_000_000;

test("flags a job still waiting, including one already flagged, and ignores a fresh one", () => {
  const waiting = classifyStuck({ status: "offered", createdAt: now - 31 * 60, assignedTechId: null }, thresholds, now);
  assert.equal(waiting?.reason, "awaiting_acceptance");
  const flagged = classifyStuck({
    status: "new", createdAt: now - 45 * 60, assignedTechId: null, operatorFlag: 1,
  }, thresholds, now);
  assert.equal(flagged?.reason, "awaiting_acceptance");
  assert.equal(classifyStuck({ status: "offered", createdAt: now - 29 * 60, assignedTechId: null }, thresholds, now), null);
});

test("flags an accepted job that has not started, using the accepted time", () => {
  const stuck = classifyStuck({
    status: "assigned",
    createdAt: now - 10 * 3600,
    updatedAt: now - 60,
    assignedAt: now - 4 * 3600,
    assignedTechId: "tech",
  }, thresholds, now);
  assert.equal(stuck?.reason, "not_started");
  assert.equal(stuck?.anchorAt, now - 4 * 3600);
  assert.equal(classifyStuck({
    status: "assigned", createdAt: now - 10 * 3600, assignedAt: now - 3 * 3600, assignedTechId: "tech",
  }, thresholds, now), null);
});

test("flags work in progress from when it started", () => {
  const stuck = classifyStuck({
    status: "on_site",
    createdAt: now - 20 * 3600,
    updatedAt: now - 30 * 60,
    startedAt: now - 8 * 3600,
    assignedTechId: "tech",
  }, thresholds, now);
  assert.equal(stuck?.reason, "in_progress");
  assert.equal(classifyStuck({
    status: "en_route", createdAt: now - 20 * 3600, startedAt: now - 2 * 3600, assignedTechId: "tech",
  }, thresholds, now), null);
  assert.equal(classifyStuck({ status: "completed", createdAt: now - 48 * 3600, assignedTechId: "tech" }, thresholds, now), null);
});

test("opens one alert per job and reason until it is resolved", () => {
  const open = [{ jobId: "job-1", reason: "awaiting_acceptance", resolvedAt: null }];
  assert.equal(isNewEpisode(open, "job-1", "awaiting_acceptance"), false);
  assert.equal(isNewEpisode([{ jobId: "job-1", reason: "awaiting_acceptance", resolvedAt: now }], "job-1", "awaiting_acceptance"), true);
  assert.equal(isNewEpisode([{ jobId: "job-1", reason: "not_started", resolvedAt: null }], "job-1", "awaiting_acceptance"), true);
});

test("accepts whole numbers and keeps texts off unless asked", () => {
  const ok = parseStuckSettings({ awaitingMinutes: "30", notStartedHours: "4", inProgressHours: "8" });
  assert.equal(ok.sms, false);
  assert.equal(ok.awaitingMinutes, 30);
  assert.equal(parseStuckSettings({ awaitingMinutes: "30.5", notStartedHours: "4", inProgressHours: "8" }).error?.length > 0, true);
  assert.equal(thresholdsFromSettings({}).sms, false);
  assert.equal(thresholdsFromSettings({ stuck_alert_sms: "1" }).sms, true);
});

test("batches several stuck jobs into one staff text", () => {
  const text = stuckAlertSms([
    { trade: "electrical", area: "Kilimani", reason: "awaiting_acceptance", ageSeconds: 45 * 60 },
    { trade: "plumbing", area: "Westlands", reason: "in_progress", ageSeconds: 9 * 3600 },
  ]);
  assert.equal(text.startsWith("Nuru & Maji: 2 stuck jobs."), true);
  assert.equal(text.includes("Kilimani"), true);
  assert.equal(text.includes("9 hours"), true);
  assert.equal(formatAge(60), "1 min");
});
