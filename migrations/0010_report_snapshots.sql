-- Saved daily and weekly digests. Additive only.
-- Each period is stored once. Texts stay off until an admin switches them on.

CREATE TABLE report_snapshots (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (period IN ('day', 'week')),
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  label TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (period, period_start)
);

INSERT INTO settings (key, value) VALUES
  ('digest_daily_sms', '0'),
  ('digest_weekly_sms', '0')
ON CONFLICT(key) DO NOTHING;
