ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS machine_started_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS billing_ended_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS machine_flavor VARCHAR(100);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS billing_owner_type VARCHAR(20);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS billing_owner_id UUID;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS billing_owner_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS sessions_machine_started_at_idx
  ON sessions(machine_started_at);

CREATE INDEX IF NOT EXISTS sessions_billing_ended_at_idx
  ON sessions(billing_ended_at);

CREATE TABLE IF NOT EXISTS session_access_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL
    REFERENCES sessions(id)
    ON DELETE CASCADE,
  user_id UUID
    REFERENCES users(id)
    ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS session_access_events_session_idx
  ON session_access_events(session_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS session_access_events_user_idx
  ON session_access_events(user_id, opened_at DESC);
