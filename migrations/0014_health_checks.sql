-- Stored health checks. Additive only.

CREATE TABLE health_checks (
  id TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL,
  slot TEXT NOT NULL UNIQUE,
  database_ok INTEGER NOT NULL,
  portal_ok INTEGER NOT NULL,
  balance_kes REAL,
  detail TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('at_balance_min_kes', '50'),
  ('health_sms', '0')
ON CONFLICT(key) DO NOTHING;
