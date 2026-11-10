-- Technician applications. Document files stay private in R2.
-- applicant_status is technician_applications.status.
-- Probation is an optional status after approval.

CREATE TABLE technician_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'needs_info', 'approved', 'rejected', 'probation')),
  personal_json TEXT,
  trades TEXT,
  experience_years INTEGER,
  specialisms TEXT,
  tools INTEGER,
  transport TEXT,
  base_lat REAL,
  base_lng REAL,
  radius_km REAL,
  availability_json TEXT,
  mpesa_number TEXT,
  references_json TEXT,
  terms_accepted_at INTEGER,
  reviewer_id TEXT,
  decision_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_applications_user ON technician_applications(user_id, updated_at);
CREATE INDEX idx_applications_status ON technician_applications(status);

CREATE TABLE technician_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  r2_key TEXT,
  number TEXT,
  expiry_date TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_documents_application ON technician_documents(application_id);
CREATE INDEX idx_documents_expiry ON technician_documents(expiry_date);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  used_by TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
