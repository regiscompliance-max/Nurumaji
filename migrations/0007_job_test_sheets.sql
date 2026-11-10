-- Readings recorded by the technician before a job is marked completed.
-- Additive only. These fields are a record, not a compliance threshold.

CREATE TABLE job_test_sheets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  trade TEXT NOT NULL,
  readings_json TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  notes TEXT,
  filled_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_test_sheets_job ON job_test_sheets(job_id);
