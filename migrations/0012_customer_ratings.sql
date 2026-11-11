-- Rating time, one text link per job, and low-rating alerts.
-- Additive only. job_alerts is not changed.

ALTER TABLE ratings ADD COLUMN created_at INTEGER;
ALTER TABLE ratings ADD COLUMN updated_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_job ON ratings(job_id);

CREATE TABLE rating_invites (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE rating_alerts (
  id TEXT PRIMARY KEY,
  rating_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  opened_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  acknowledged_by TEXT,
  resolution_note TEXT
);
CREATE INDEX idx_rating_alerts_open ON rating_alerts(acknowledged_at, opened_at);

INSERT INTO settings (key, value) VALUES
  ('rating_sms', '0'),
  ('rating_sms_delay_hours', '2')
ON CONFLICT(key) DO NOTHING;
