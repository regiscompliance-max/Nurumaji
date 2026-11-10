-- Counts booking attempts so the job endpoint can be rate-limited.

CREATE TABLE booking_limits (
  id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_booking_limits_bucket ON booking_limits(bucket, created_at);
