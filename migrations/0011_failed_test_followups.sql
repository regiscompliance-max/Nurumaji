-- One return visit per failed test sheet.
-- job_alerts.reason is a fixed list. SQLite cannot alter that check,
-- so failed-test alerts live here instead of rewriting job_alerts.

CREATE TABLE job_followups (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL UNIQUE,
  original_job_id TEXT NOT NULL,
  return_job_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  acknowledged_by TEXT
);
CREATE INDEX idx_followups_original ON job_followups(original_job_id);
CREATE INDEX idx_followups_open ON job_followups(acknowledged_at, created_at);
