-- Emergency call-outs stay off until an admin accepts them.
-- The amounts are proposed defaults. An admin can change them.

ALTER TABLE technician_profiles ADD COLUMN on_call INTEGER NOT NULL DEFAULT 0;

INSERT INTO settings (key, value) VALUES
  ('emergency_bookings', '0'),
  ('emergency_min_kes', '4000'),
  ('emergency_night_percent', '50'),
  ('emergency_weekend_percent', '25'),
  ('emergency_target_hours', '2'),
  ('emergency_show_target', '0'),
  ('emergency_alert', '0'),
  ('emergency_services_number', ''),
  ('whatsapp_emergency_template', 'nurumaji_emergency_alert')
ON CONFLICT(key) DO NOTHING;
