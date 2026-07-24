BEGIN;

CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY,

  tenant_id UUID NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  invited_by_user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE RESTRICT,

  accepted_by_user_id UUID
    REFERENCES users(id)
    ON DELETE SET NULL,

  email TEXT NOT NULL,

  role TEXT NOT NULL
    CHECK (
      role IN (
        'admin',
        'member'
      )
    ),

  token_hash CHAR(64) NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

  expires_at TIMESTAMPTZ NOT NULL,

  accepted_at TIMESTAMPTZ,

  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS
  user_invitations_tenant_id_idx
ON user_invitations (
  tenant_id
);

CREATE INDEX IF NOT EXISTS
  user_invitations_email_idx
ON user_invitations (
  tenant_id,
  LOWER(email)
);

CREATE INDEX IF NOT EXISTS
  user_invitations_expires_at_idx
ON user_invitations (
  expires_at
);

COMMIT;