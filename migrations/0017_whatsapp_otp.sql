-- WhatsApp login codes stay off until an admin switches them on.

INSERT INTO settings (key, value) VALUES
  ('whatsapp_otp', '0'),
  ('whatsapp_otp_template', 'nurumaji_login_code')
ON CONFLICT(key) DO NOTHING;
