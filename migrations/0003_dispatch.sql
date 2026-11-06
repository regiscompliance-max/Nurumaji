-- Dispatch settings and the operator flag. Offer timeout defaults to 10 minutes.

ALTER TABLE jobs ADD COLUMN materials TEXT;
ALTER TABLE jobs ADD COLUMN minutes_spent INTEGER;
ALTER TABLE jobs ADD COLUMN operator_flag INTEGER NOT NULL DEFAULT 0;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('offer_timeout_seconds', '600'),
  ('exclude_busy_technicians', '1');

CREATE INDEX idx_job_offers_tech ON job_offers(tech_id, status);
