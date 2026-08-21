ALTER TABLE sessions
DROP CONSTRAINT IF EXISTS sessions_status_check;

ALTER TABLE sessions
ADD CONSTRAINT sessions_status_check
CHECK (
  status IN (
    'queued',
    'provisioning',
    'bootstrapping',
    'dns_pending',
    'tls_pending',
    'ready',
    'destroying',
    'destroyed',
    'failed',
    'error'
  )
);
