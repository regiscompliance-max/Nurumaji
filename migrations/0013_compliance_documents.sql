-- Working-technician documents and a dispatch hold. Additive only.
-- Applicant files stay in technician_documents.

ALTER TABLE technician_profiles ADD COLUMN dispatch_hold TEXT;

CREATE TABLE compliance_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('id', 'insurance', 'licence', 'certificate')),
  expiry_date TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  replaced_at INTEGER
);
CREATE INDEX idx_compliance_user ON compliance_documents(user_id, doc_type, replaced_at);

CREATE TABLE compliance_reminders (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  days INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (document_id, days)
);

INSERT INTO settings (key, value) VALUES ('compliance_sms', '0')
ON CONFLICT(key) DO NOTHING;
