const crypto = require('crypto');

const database = require(
  '../database/database'
);

/**
 * Crée un utilisateur dans PostgreSQL.
 *
 * Le mot de passe reçu doit déjà être chiffré.
 */
async function createUser({
  tenantId,
  email,
  passwordHash,
  role = 'member',
}) {
  if (
    !tenantId ||
    !email ||
    !passwordHash
  ) {
    throw new Error(
      'Le tenant, l’email et le mot de passe chiffré sont obligatoires.'
    );
  }

  const id = crypto.randomUUID();
  const normalizedEmail =
    email.trim().toLowerCase();

  const result = await database.query(
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
      id,
      tenantId,
      normalizedEmail,
      passwordHash,
      role,
    ]
  );

  return result.rows[0];
}

/**
 * Recherche un utilisateur par son email.
 *
 * Le password_hash est retourné uniquement
 * pour permettre la vérification lors du login.
 */
async function findUserByEmail(email) {
  const normalizedEmail =
    email.trim().toLowerCase();

  const result = await database.query(
    `
      SELECT
        id,
        tenant_id,
        email,
        password_hash,
        role,
        created_at
      FROM users
      WHERE LOWER(email) = $1
    `,
    [normalizedEmail]
  );

  return result.rows[0] || null;
}

/**
 * Recherche un utilisateur par son identifiant.
 */
async function findUserById(id) {
  const result = await database.query(
    `
      SELECT
        id,
        tenant_id,
        email,
        role,
        created_at
      FROM users
      WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}
/**
 * Liste les utilisateurs d’une organisation.
 *
 * Le tenantId est toujours fourni par le backend
 * à partir de l’utilisateur connecté.
 */
async function listUsersByTenantId(
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
        id,
        tenant_id,
        email,
        role,
        created_at

      FROM users

      WHERE tenant_id = $1

      ORDER BY created_at ASC
    `,
    [tenantId]
  );

  return result.rows;
}
/**
 * Supprime un utilisateur appartenant à un tenant.
 *
 * @param {object} options Données de suppression.
 * @param {string} options.userId Identifiant utilisateur.
 * @param {string} options.tenantId Identifiant du tenant.
 * @returns {Promise<object|null>}
 */
async function deleteUserByIdAndTenantId({
  userId,
  tenantId,
}) {
  const result = await database.query(
    `
      DELETE FROM users

      WHERE id = $1
        AND tenant_id = $2

      RETURNING
        id,
        tenant_id,
        email,
        role
    `,
    [
      userId,
      tenantId,
    ]
  );

  return result.rows[0] || null;
}
module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  deleteUserByIdAndTenantId,
  listUsersByTenantId,
};