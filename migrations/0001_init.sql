-- Phase 1 schema. Later phases use the job tables; this release only writes
-- users, sessions, and otp_codes.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'technician', 'operator', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE otp_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  ip TEXT
);
CREATE INDEX idx_otp_phone_created ON otp_codes(phone, created_at);
CREATE INDEX idx_otp_ip_created ON otp_codes(ip, created_at);

CREATE TABLE technician_profiles (
  user_id TEXT PRIMARY KEY,
  trades TEXT NOT NULL DEFAULT '',
  base_lat REAL,
  base_lng REAL,
  radius_km REAL,
  on_duty INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  trade TEXT NOT NULL CHECK (trade IN ('electrical', 'plumbing')),
  description TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('standard', 'urgent', 'emergency')),
  address TEXT,
  lat REAL,
  lng REAL,
  preferred_time INTEGER,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'offered', 'assigned', 'en_route', 'on_site', 'completed', 'invoiced', 'paid', 'cancelled'
  )),
  assigned_tech_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_tech ON jobs(assigned_tech_id);

CREATE TABLE job_offers (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  tech_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('offered', 'accepted', 'declined', 'expired')),
  offered_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_job_offers_job ON job_offers(job_id);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  actor_id TEXT,
  type TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_job_events_job ON job_events(job_id, created_at);

CREATE TABLE job_photos (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  amount_kes INTEGER NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved', 'rejected')),
  created_at INTEGER NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  amount_kes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  paid_at INTEGER
);

CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tech_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL
);
