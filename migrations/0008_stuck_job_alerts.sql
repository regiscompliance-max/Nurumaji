-- Stuck-job thresholds live in the existing settings table.
-- Alerts are additive. One open row per job and reason until it is
-- acknowledged or the job leaves that state.

INSERT INTO settings (key, value) VALUES
  ('stuck_awaiting_minutes', '30'),
  ('stuck_not_started_hours', '4'),
  ('stuck_in_progress_hours', '8'),
  ('stuck_alert_sms', '0')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE job_alerts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('awaiting_acceptance', 'not_started', 'in_progress')),
  anchor_at INTEGER NOT NULL,
  opened_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  acknowledged_by TEXT,
  resolved_at INTEGER
);

CREATE UNIQUE INDEX idx_job_alerts_open ON job_alerts(job_id, reason) WHERE resolved_at IS NULL;
CREATE INDEX idx_job_alerts_board ON job_alerts(acknowledged_at, resolved_at, opened_at);
