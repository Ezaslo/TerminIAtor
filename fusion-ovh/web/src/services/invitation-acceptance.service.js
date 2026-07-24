const crypto = require('crypto');

const database = require(
  '../database/database'
);

/**
 * Crée l'utilisateur et marque l'invitation
 * comme acceptée dans une seule transaction.
 */
async function acceptInvitationAndCreateUser({
  tokenHash,
  passwordHash,
}) {
  if (!tokenHash || !passwordHash) {
    throw new Error(
      'Le jeton et le mot de passe chiffré sont obligatoires.'
    );
  }

  const client =
    await database.getPool().connect();

  try {
    await client.query('BEGIN');

    const invitationResult =
      await client.query(
        `
          SELECT
            user_invitations.id,
            user_invitations.tenant_id,
            user_invitations.email,
            user_invitations.role,

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

          FOR UPDATE OF user_invitations
        `,
        [tokenHash]
      );

    const invitation =
      invitationResult.rows[0];

    if (!invitation) {
      await client.query('ROLLBACK');
      return null;
    }

    const existingUserResult =
      await client.query(
        `
          SELECT id

          FROM users

          WHERE LOWER(email) =
            LOWER($1)

          LIMIT 1
        `,
        [invitation.email]
      );

    if (existingUserResult.rows[0]) {
      const error = new Error(
        'Un compte existe déjà pour cette adresse email.'
      );

      error.code =
        'EMAIL_ALREADY_EXISTS';

      throw error;
    }

    const userId = crypto.randomUUID();

    const userResult =
      await client.query(
        `
          INSERT INTO users (
            id,
            tenant_id,
            email,
            password_hash,
            role
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )
          RETURNING
            id,
            tenant_id,
            email,
            role,
            created_at
        `,
        [
          userId,
          invitation.tenant_id,
          invitation.email,
          passwordHash,
          invitation.role,
        ]
      );

    await client.query(
      `
        UPDATE user_invitations

        SET
          accepted_at = NOW(),
          accepted_by_user_id = $2

        WHERE id = $1
      `,
      [
        invitation.id,
        userId,
      ]
    );

    await client.query('COMMIT');

    return {
      user: userResult.rows[0],

      tenant: {
        id: invitation.tenant_id,
        name: invitation.tenant_name,
        slug: invitation.tenant_slug,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // La transaction est peut-être déjà terminée.
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  acceptInvitationAndCreateUser,
};