const crypto = require('crypto');

const database = require(
  '../database/database'
);

/**
 * Crée un tenant dans PostgreSQL.
 */
async function createTenant({
  name,
  slug,
}) {
  if (!name || !slug) {
    throw new Error(
      'Le nom et le slug du tenant sont obligatoires.'
    );
  }

  const id = crypto.randomUUID();

  const result = await database.query(
    `
      INSERT INTO tenants (
        id,
        name,
        slug
      )
      VALUES (
        $1,
        $2,
        $3
      )
      RETURNING
        id,
        name,
        slug,
        created_at
    `,
    [
      id,
      name.trim(),
      slug.trim().toLowerCase(),
    ]
  );

  return result.rows[0];
}

/**
 * Recherche un tenant par son identifiant.
 */
async function findTenantById(id) {
  const result = await database.query(
    `
      SELECT
        id,
        name,
        slug,
        created_at
      FROM tenants
      WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * Recherche un tenant par son slug.
 */
async function findTenantBySlug(slug) {
  const result = await database.query(
    `
      SELECT
        id,
        name,
        slug,
        created_at
      FROM tenants
      WHERE slug = $1
    `,
    [
      slug.trim().toLowerCase(),
    ]
  );

  return result.rows[0] || null;
}

module.exports = {
  createTenant,
  findTenantById,
  findTenantBySlug,
};