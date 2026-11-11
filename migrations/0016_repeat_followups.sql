-- Due-again reminders for past clients. Additive only.

ALTER TABLE users ADD COLUMN followup_opt_out INTEGER NOT NULL DEFAULT 0;

CREATE TABLE followup_reminders (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('electrical_check', 'water_heater')),
  due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'contacted', 'booked', 'dismissed')),
  created_at INTEGER NOT NULL,
  UNIQUE (job_id, kind)
);
CREATE INDEX idx_followup_status ON followup_reminders(status, due_on);

INSERT INTO settings (key, value) VALUES
  ('repeat_electrical_months', '12'),
  ('repeat_heater_months', '12'),
  ('repeat_sms', '0')
ON CONFLICT(key) DO NOTHING;
