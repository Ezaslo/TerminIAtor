const crypto = require('crypto');

const database = require(
  '../database/database'
);

const ALLOWED_ROLES = new Set([
  'admin',
  'member',
]);

/**
 * Crée une invitation dans PostgreSQL.
 *
 * tokenHash contient uniquement l’empreinte
 * du jeton secret, jamais le jeton brut.
 */
async function createInvitation({
  tenantId,
  invitedByUserId,
  email,
  role,
  tokenHash,
  expiresAt,
}) {
  const normalizedEmail =
    typeof email === 'string'
      ? email.trim().toLowerCase()
      : '';

  if (
    !tenantId ||
    !invitedByUserId ||
    !normalizedEmail ||
    !tokenHash ||
    !expiresAt
  ) {
    throw new Error(
      'Les informations de l’invitation sont incomplètes.'
    );
  }

  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(
      'Le rôle de l’invitation est invalide.'
    );
  }

  const id = crypto.randomUUID();

  const result = await database.query(
    `
      INSERT INTO user_invitations (
        id,
        tenant_id,
        invited_by_user_id,
        email,
        role,
        token_hash,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
      RETURNING
        id,
        tenant_id,
        invited_by_user_id,
        email,
        role,
        created_at,
        expires_at
    `,
    [
      id,
      tenantId,
      invitedByUserId,
      normalizedEmail,
      role,
      tokenHash,
      expiresAt,
    ]
  );

  return result.rows[0];
}

/**
 * Recherche une invitation encore utilisable
 * grâce au hash du jeton reçu.
 */
async function findActiveInvitationByTokenHash(
  tokenHash
) {
  if (!tokenHash) {
    return null;
  }

  const result = await database.query(
    `
      SELECT
        user_invitations.id,
        user_invitations.tenant_id,
        user_invitations.invited_by_user_id,
        user_invitations.email,
        user_invitations.role,
        user_invitations.created_at,
        user_invitations.expires_at,

        tenants.name AS tenant_name,
        tenants.slug AS tenant_slug

      FROM user_invitations

      INNER JOIN tenants
        ON tenants.id =
          user_invitations.tenant_id

      WHERE user_invitations.token_hash = $1
        AND user_invitations.accepted_at IS NULL
        AND user_invitations.revoked_at IS NULL
        AND user_invitations.expires_at > NOW()
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

/**
 * Liste les invitations encore en attente
 * pour une organisation.
 */
async function listPendingInvitationsByTenantId(
  tenantId
) {
  if (!tenantId) {
    throw new Error(
      'Le tenant est obligatoire.'
    );
  }

  const result = await database.query(
    `
      SELECT
        user_invitations.id,
        user_invitations.email,
        user_invitations.role,
        user_invitations.created_at,
        user_invitations.expires_at,

        users.email AS invited_by_email

      FROM user_invitations

      INNER JOIN users
        ON users.id =
          user_invitations.invited_by_user_id

      WHERE user_invitations.tenant_id = $1
        AND user_invitations.accepted_at IS NULL
        AND user_invitations.revoked_at IS NULL
        AND user_invitations.expires_at > NOW()

      ORDER BY
        user_invitations.created_at DESC
    `,
    [tenantId]
  );

  return result.rows;
}

/**
 * Révoque une invitation appartenant
 * au tenant connecté.
 */
/**
 * Recherche une invitation encore active
 * pour une adresse email dans un tenant.
 */
async function findPendingInvitationByEmail({
  tenantId,
  email,
}) {
  const normalizedEmail =
    typeof email === 'string'
      ? email.trim().toLowerCase()
      : '';

  if (!tenantId || !normalizedEmail) {
    return null;
  }

  const result = await database.query(
    `
      SELECT
        id,
        tenant_id,
        email,
        role,
        created_at,
        expires_at

      FROM user_invitations

      WHERE tenant_id = $1
        AND LOWER(email) = $2
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > NOW()

      ORDER BY created_at DESC

      LIMIT 1
    `,
    [
      tenantId,
      normalizedEmail,
    ]
  );

  return result.rows[0] || null;
}
async function revokeInvitationById({
  invitationId,
  tenantId,
}) {
  if (!invitationId || !tenantId) {
    return null;
  }

  const result = await database.query(
    `
      UPDATE user_invitations

      SET revoked_at = NOW()

      WHERE id = $1
        AND tenant_id = $2
        AND accepted_at IS NULL
        AND revoked_at IS NULL

      RETURNING
        id,
        email,
        revoked_at
    `,
    [
      invitationId,
      tenantId,
    ]
  );

  return result.rows[0] || null;
}
module.exports = {
  createInvitation,
  findActiveInvitationByTokenHash,
  findPendingInvitationByEmail,
  listPendingInvitationsByTenantId,
  revokeInvitationById,
};