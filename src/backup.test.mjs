import assert from "node:assert/strict";
import test from "node:test";
import { expiredBackupKeys, isBackupTable, shouldBackup } from "./backup.mjs";

test("runs the backup once at 02:00 Nairobi", () => {
  assert.equal(shouldBackup(2, "", "2026-11-11"), true);
  assert.equal(shouldBackup(2, "2026-11-11", "2026-11-11"), false);
  assert.equal(shouldBackup(3, "", "2026-11-11"), false);
});

test("leaves out sign-in secrets and deletes backups older than 30 days", () => {
  assert.equal(isBackupTable("jobs"), true);
  assert.equal(isBackupTable("otp_codes"), false);
  assert.equal(isBackupTable("sessions"), false);
  assert.equal(isBackupTable("rating_invites"), false);
  const old = expiredBackupKeys([
    "backups/2026-09-01.json",
    "backups/2026-11-01.json",
    "backups/notes.txt",
  ], "2026-11-11", 30);
  assert.deepEqual(old, ["backups/2026-09-01.json"]);
});
