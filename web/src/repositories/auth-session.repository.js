const crypto = require('crypto');

const database = require(
  '../database/database'
);

/**
 * Crée une session d’authentification.
 *
 * Le token brut ne doit jamais être transmis ici.
 * On enregistre uniquement son hash SHA-256.
 */
async function createAuthSession({
  userId,
  tokenHash,
  expiresAt,
  ipAddress = null,
  userAgent = null,
}) {
  if (
    !userId ||
    !tokenHash ||
    !expiresAt
  ) {
    throw new Error(
      'L’utilisateur, le hash du token et la date d’expiration sont obligatoires.'
    );
  }

  const id = crypto.randomUUID();

  const result = await database.query(
    `
      INSERT INTO auth_sessions (
        id,
        user_id,
        token_hash,
        ip_address,
        user_agent,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
      RETURNING
        id,
        user_id,
        created_at,
        last_seen_at,
        expires_at
    `,
    [
      id,
      userId,
      tokenHash,
      ipAddress,
      userAgent,
      expiresAt,
    ]
  );

  return result.rows[0];
}

/**
 * Recherche une connexion active grâce
 * au hash du token reçu dans le cookie.
 */
async function findActiveSessionByTokenHash(
  tokenHash
) {
  const result = await database.query(
    `
      SELECT
        auth_sessions.id,
        auth_sessions.user_id,
        auth_sessions.created_at,
        auth_sessions.last_seen_at,
        auth_sessions.expires_at,

        users.email,
        users.role,
        users.tenant_id,

        tenants.name AS tenant_name,
        tenants.slug AS tenant_slug

      FROM auth_sessions

      INNER JOIN users
        ON users.id = auth_sessions.user_id

      INNER JOIN tenants
        ON tenants.id = users.tenant_id

      WHERE auth_sessions.token_hash = $1
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.expires_at > NOW()
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

/**
 * Met à jour la date de dernière activité.
 */
async function touchAuthSession(id) {
  const result = await database.query(
    `
      UPDATE auth_sessions

      SET last_seen_at = NOW()

      WHERE id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()

      RETURNING
        id,
        last_seen_at
    `,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Révoque une connexion.
 *
 * Le cookie ne sera plus accepté après cela.
 */
async function revokeAuthSessionByTokenHash(
  tokenHash
) {
  const result = await database.query(
    `
      UPDATE auth_sessions

      SET revoked_at = NOW()

      WHERE token_hash = $1
        AND revoked_at IS NULL

      RETURNING
        id,
        revoked_at
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

/**
 * Supprime les anciennes connexions expirées
 * ou révoquées.
 */
/**
 * Révoque une session grâce à son identifiant.
 *
 * Cette fonction sera utilisée lors de la déconnexion.
 */
async function revokeAuthSessionById(id) {
  if (!id) {
    return null;
  }

  const result = await database.query(
    `
      UPDATE auth_sessions

      SET revoked_at = NOW()

      WHERE id = $1
        AND revoked_at IS NULL

      RETURNING
        id,
        revoked_at
    `,
    [id]
  );

  return result.rows[0] || null;
}
async function deleteInactiveAuthSessions() {
  const result = await database.query(`
    DELETE FROM auth_sessions

    WHERE expires_at <= NOW()
       OR revoked_at IS NOT NULL
  `);

  return result.rowCount;
}

module.exports = {
  createAuthSession,
  findActiveSessionByTokenHash,
  touchAuthSession,
  revokeAuthSessionByTokenHash,
  revokeAuthSessionById,
  deleteInactiveAuthSessions,
};