-- Due dates and payment reminders. Additive only.
-- Existing invoices take their issue time from the invoiced job event, plus 7 days.

ALTER TABLE invoices ADD COLUMN due_at INTEGER;
ALTER TABLE invoices ADD COLUMN reminders_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN payment_method TEXT;
ALTER TABLE invoices ADD COLUMN mpesa_code TEXT;

UPDATE invoices
SET due_at = (
  SELECT MIN(job_events.created_at) + (7 * 86400)
  FROM job_events
  WHERE job_events.job_id = invoices.job_id AND job_events.type = 'invoiced'
)
WHERE due_at IS NULL
  AND EXISTS (
    SELECT 1 FROM job_events
    WHERE job_events.job_id = invoices.job_id AND job_events.type = 'invoiced'
  );

INSERT INTO settings (key, value) VALUES
  ('invoice_due_days', '7'),
  ('payment_reminder_offsets', '0,3,7'),
  ('payment_reminders_sms', '0')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE invoice_reminders (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE (invoice_id, offset_days)
);
CREATE INDEX idx_invoice_reminders_invoice ON invoice_reminders(invoice_id);
