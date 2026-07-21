BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,

  role VARCHAR(20) NOT NULL DEFAULT 'member',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_role_check
    CHECK (
      role IN (
        'owner',
        'admin',
        'member'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  users_email_unique_idx
ON users (
  LOWER(email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,

  tenant_id UUID NOT NULL
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  created_by_user_id UUID
    REFERENCES users(id)
    ON DELETE SET NULL,

  name VARCHAR(120) NOT NULL,
  slug VARCHAR(100) NOT NULL,

  status VARCHAR(30) NOT NULL DEFAULT 'queued',

  instance_id VARCHAR(100),
  elastic_ip INET,
  dns_name VARCHAR(255),
  access_url TEXT,

  terraform_directory TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  destroyed_at TIMESTAMPTZ,

  CONSTRAINT sessions_status_check
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
        'failed'
      )
    ),

  CONSTRAINT sessions_tenant_slug_unique
    UNIQUE (
      tenant_id,
      slug
    )
);

CREATE TABLE IF NOT EXISTS session_events (
  id BIGSERIAL PRIMARY KEY,

  session_id UUID NOT NULL
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  event_type VARCHAR(50) NOT NULL,
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
  sessions_tenant_status_idx
ON sessions (
  tenant_id,
  status
);

CREATE INDEX IF NOT EXISTS
  sessions_expires_at_idx
ON sessions (
  expires_at
);

CREATE INDEX IF NOT EXISTS
  session_events_session_created_idx
ON session_events (
  session_id,
  created_at DESC
);

COMMIT;