BEGIN;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,

  user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  token_hash CHAR(64) NOT NULL UNIQUE,

  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS
  auth_sessions_user_id_idx
ON auth_sessions (
  user_id
);

CREATE INDEX IF NOT EXISTS
  auth_sessions_expires_at_idx
ON auth_sessions (
  expires_at
);

COMMIT;