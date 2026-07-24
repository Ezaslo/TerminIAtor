CREATE TABLE IF NOT EXISTS session_users (
  session_id UUID NOT NULL
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (
    session_id,
    user_id
  )
);

CREATE INDEX IF NOT EXISTS
  session_users_user_id_idx
ON session_users (
  user_id
);