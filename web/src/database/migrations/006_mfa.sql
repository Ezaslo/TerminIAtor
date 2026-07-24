CREATE TABLE IF NOT EXISTS user_mfa (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret_ciphertext BYTEA NOT NULL,
  totp_secret_iv BYTEA NOT NULL,
  totp_secret_auth_tag BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_mfa_recovery_codes_user_hash_unique UNIQUE (user_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_codes_user_id ON user_mfa_recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_codes_unused ON user_mfa_recovery_codes(user_id) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_hash CHAR(64) NOT NULL UNIQUE,
  purpose VARCHAR(30) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT mfa_challenge_purpose_check CHECK (purpose IN ('login', 'setup', 'disable')),
  CONSTRAINT mfa_challenge_attempts_check CHECK (attempts >= 0),
  CONSTRAINT mfa_challenge_max_attempts_check CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_id ON mfa_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires_at ON mfa_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_active ON mfa_challenges(user_id, purpose) WHERE consumed_at IS NULL;
