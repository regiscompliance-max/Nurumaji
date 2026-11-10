-- Last shared position while a technician is on duty.
-- Additive only. Clients never read these columns.

ALTER TABLE technician_profiles ADD COLUMN live_lat REAL;
ALTER TABLE technician_profiles ADD COLUMN live_lng REAL;
ALTER TABLE technician_profiles ADD COLUMN live_updated_at INTEGER;
