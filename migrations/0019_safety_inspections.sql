-- Electrical safety inspections. The reminder text stays off until an admin switches it on.
-- The price is a labelled "from" range. It is not a fixed quote.

ALTER TABLE jobs ADD COLUMN service_key TEXT;

INSERT INTO settings (key, value) VALUES
  ('inspection_price_from', '6,000–8,000'),
  ('inspection_reminder_sms', '0')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE safety_inspections (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  readings_json TEXT NOT NULL,
  recommendations TEXT,
  result TEXT NOT NULL CHECK (result IN ('satisfactory', 'unsatisfactory')),
  inspected_on TEXT NOT NULL,
  next_due_on TEXT NOT NULL,
  inspector_id TEXT NOT NULL,
  reminder_sent_on TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_safety_inspections_due ON safety_inspections(next_due_on);
