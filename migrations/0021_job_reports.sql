-- Before and after photos, and the job report message, stay optional.
-- Marketing use stays off for every photo until an admin marks it and the client has agreed.

ALTER TABLE job_photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'attachment';
ALTER TABLE job_photos ADD COLUMN marketing_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN photo_consent INTEGER NOT NULL DEFAULT 0;

INSERT INTO settings (key, value) VALUES
  ('close_photos_required', '0'),
  ('close_report_sms', '0'),
  ('warranty_repair_days', '90'),
  ('warranty_install_months', '12'),
  ('whatsapp_report_template', 'nurumaji_job_report')
ON CONFLICT(key) DO NOTHING;
