-- Quotes and invoices. Amounts are typed by an operator. There is no default price.

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  amount_kes INTEGER NOT NULL,
  items_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'approved', 'declined')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_quotes_job ON quotes(job_id, created_at);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  amount_kes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued', 'paid')),
  paid_at INTEGER
);
CREATE INDEX idx_invoices_job ON invoices(job_id);
