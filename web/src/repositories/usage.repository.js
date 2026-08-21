const database = require('../database/database');

async function setBillingOwnerSnapshot(
  sessionId,
  owner
) {
  const result = await database.query(
    `
      UPDATE sessions
      SET
        billing_owner_type = $2,
        billing_owner_id = $3,
        billing_owner_name = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      sessionId,
      owner.type,
      owner.id || null,
      owner.name,
    ]
  );

  return result.rows[0] || null;
}

async function markMachineStarted(
  sessionId,
  machineFlavor = null
) {
  const result = await database.query(
    `
      UPDATE sessions
      SET
        machine_started_at = COALESCE(machine_started_at, NOW()),
        machine_flavor = COALESCE(machine_flavor, $2),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      sessionId,
      machineFlavor || null,
    ]
  );

  return result.rows[0] || null;
}

async function markReady(sessionId) {
  const result = await database.query(
    `
      UPDATE sessions
      SET
        status = 'ready',
        ready_at = COALESCE(ready_at, NOW()),
        expires_at = CASE
          WHEN ready_at IS NULL
            AND session_ttl_hours IS NOT NULL
          THEN NOW() + (session_ttl_hours * INTERVAL '1 hour')
          ELSE expires_at
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [sessionId]
  );

  return result.rows[0] || null;
}

async function recordAccess(
  sessionId,
  userId
) {
  const result = await database.query(
    `
      INSERT INTO session_access_events (
        session_id,
        user_id
      )
      VALUES (
        $1,
        $2
      )
      RETURNING *
    `,
    [
      sessionId,
      userId,
    ]
  );

  return result.rows[0];
}

async function listTenantUsage(
  tenantId,
  from,
  to
) {
  const result = await database.query(
    `
      SELECT
        sessions.id,
        sessions.name,
        sessions.status,
        sessions.session_mode,
        sessions.group_id,
        sessions.created_by_user_id,
        sessions.machine_flavor,
        sessions.billing_owner_type,
        sessions.billing_owner_id,
        sessions.billing_owner_name,
        sessions.machine_started_at,
        sessions.ready_at,
        sessions.billing_ended_at,
        sessions.destroyed_at,
        creator.email AS creator_email,
        billing_group.name AS group_name,
        COUNT(DISTINCT session_access_events.id)::int AS access_count,
        (
          SELECT COUNT(*)::int
          FROM session_users
          WHERE session_users.session_id = sessions.id
        ) AS authorized_user_count,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'id', access_user.id,
              'email', access_user.email
            )
          ) FILTER (
            WHERE access_user.id IS NOT NULL
          ),
          '[]'::JSONB
        ) AS participants,
        GREATEST(
          sessions.machine_started_at,
          $2::TIMESTAMPTZ
        ) AS period_started_at,
        LEAST(
          COALESCE(
            sessions.billing_ended_at,
            sessions.destroyed_at,
            NOW()
          ),
          $3::TIMESTAMPTZ
        ) AS period_ended_at,
        GREATEST(
          0,
          EXTRACT(
            EPOCH FROM (
              LEAST(
                COALESCE(
                  sessions.billing_ended_at,
                  sessions.destroyed_at,
                  NOW()
                ),
                $3::TIMESTAMPTZ
              )
              -
              GREATEST(
                sessions.machine_started_at,
                $2::TIMESTAMPTZ
              )
            )
          )
        )::BIGINT AS billable_seconds
      FROM sessions
      LEFT JOIN users AS creator
        ON creator.id = sessions.created_by_user_id
      LEFT JOIN groups AS billing_group
        ON billing_group.id = sessions.group_id
      LEFT JOIN session_access_events
        ON session_access_events.session_id = sessions.id
      LEFT JOIN users AS access_user
        ON access_user.id = session_access_events.user_id
      WHERE sessions.tenant_id = $1
        AND sessions.machine_started_at IS NOT NULL
        AND sessions.machine_started_at < $3::TIMESTAMPTZ
        AND COALESCE(
          sessions.billing_ended_at,
          sessions.destroyed_at,
          NOW()
        ) > $2::TIMESTAMPTZ
      GROUP BY
        sessions.id,
        creator.email,
        billing_group.name
      ORDER BY sessions.machine_started_at DESC
    `,
    [
      tenantId,
      from,
      to,
    ]
  );

  return result.rows;
}

module.exports = {
  setBillingOwnerSnapshot,
  markMachineStarted,
  markReady,
  recordAccess,
  listTenantUsage,
};
