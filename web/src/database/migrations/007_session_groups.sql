ALTER TABLE sessions
  ADD COLUMN session_mode VARCHAR(20) NOT NULL DEFAULT 'individual';

ALTER TABLE sessions
  ADD COLUMN group_id UUID;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_session_mode_check
  CHECK (
    session_mode IN (
      'individual',
      'team'
    )
  );

ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_group
  FOREIGN KEY (group_id)
  REFERENCES groups(id)
  ON DELETE SET NULL;

CREATE INDEX idx_sessions_group_id
  ON sessions(group_id);

CREATE UNIQUE INDEX uq_sessions_active_team_group
  ON sessions(group_id)
  WHERE
    session_mode = 'team'
    AND group_id IS NOT NULL
    AND status IN (
      'queued',
      'provisioning',
      'bootstrapping',
      'dns_pending',
      'tls_pending',
      'ready'
    );
