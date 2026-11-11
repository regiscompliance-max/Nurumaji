-- Backup status. The files themselves live in R2 under backups/.

INSERT INTO settings (key, value) VALUES
  ('backup_last_on', ''),
  ('backup_last_status', 'none'),
  ('backup_last_key', '')
ON CONFLICT(key) DO NOTHING;
