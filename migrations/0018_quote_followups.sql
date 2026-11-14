-- Quote follow-ups stay off until an admin switches them on.
-- A blank last-reminder interval means the second nudge is not sent.

INSERT INTO settings (key, value) VALUES
  ('quote_followup_days', '3'),
  ('quote_followup_final_days', ''),
  ('quote_followup_sms', '0'),
  ('whatsapp_quote_template', 'nurumaji_quote_followup')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE quote_nudges (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('first', 'final')),
  sent_at INTEGER NOT NULL,
  UNIQUE (quote_id, kind)
);
CREATE INDEX idx_quote_nudges_quote ON quote_nudges(quote_id);
