-- Le TTL utilisateur (1h / 2h / 3h) démarre lorsque le workspace devient ready.
-- expires_at reste disponible avant ready comme garde-fou de provisioning, puis
-- est recalculé une seule fois à partir du premier ready_at.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_ttl_hours INTEGER;

UPDATE sessions
SET session_ttl_hours = ROUND(
  EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600.0
)::INTEGER
WHERE session_ttl_hours IS NULL
  AND expires_at IS NOT NULL
  AND ROUND(
    EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600.0
  )::INTEGER IN (1, 2, 3);

ALTER TABLE sessions
DROP CONSTRAINT IF EXISTS sessions_session_ttl_hours_check;

ALTER TABLE sessions
ADD CONSTRAINT sessions_session_ttl_hours_check
CHECK (
  session_ttl_hours IS NULL
  OR session_ttl_hours IN (1, 2, 3)
);
