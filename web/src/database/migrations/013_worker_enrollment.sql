BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS worker_enrollment_token_hash CHAR(64);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS worker_enrollment_issued_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS worker_enrollment_expires_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS worker_enrollment_consumed_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS worker_enrollment_csr_sha256 CHAR(64);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS worker_certificate_pem TEXT;

COMMIT;