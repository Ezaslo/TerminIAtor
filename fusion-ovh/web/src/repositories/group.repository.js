const crypto = require('crypto');

const database = require('../database/database');

/**
 * Liste les groupes appartenant à une organisation,
 * avec leurs membres.
 */
async function listGroupsByTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('Le tenant est obligatoire.');
  }

  const result = await database.query(
    `
      SELECT
        groups.id,
        groups.tenant_id,
        groups.name,
        groups.created_by,
        groups.created_at,

        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', users.id,
              'email', users.email,
              'role', users.role,
              'createdAt', group_members.created_at
            )
            ORDER BY group_members.created_at ASC
          ) FILTER (
            WHERE users.id IS NOT NULL
          ),
          '[]'::JSON
        ) AS members

      FROM groups

      LEFT JOIN group_members
        ON group_members.group_id = groups.id

      LEFT JOIN users
        ON users.id = group_members.user_id
        AND users.tenant_id = groups.tenant_id

      WHERE groups.tenant_id = $1

      GROUP BY groups.id

      ORDER BY groups.created_at ASC
    `,
    [tenantId]
  );

  return result.rows;
}

/**
 * Crée un groupe dans une organisation.
 */
async function createGroup({
  tenantId,
  name,
  createdBy,
}) {
  if (!tenantId || !name || !createdBy) {
    throw new Error(
      'Le tenant, le nom et le créateur sont obligatoires.'
    );
  }

  const id = crypto.randomUUID();
  const normalizedName = name.trim();

  const result = await database.query(
    `
      INSERT INTO groups (
        id,
        tenant_id,
        name,
        created_by
      )
      SELECT
        $1,
        $2,
        $3,
        users.id

      FROM users

      WHERE users.id = $4
        AND users.tenant_id = $2

      RETURNING
        id,
        tenant_id,
        name,
        created_by,
        created_at
    `,
    [
      id,
      tenantId,
      normalizedName,
      createdBy,
    ]
  );

  return result.rows[0] || null;
}

/**
 * Recherche un groupe par son identifiant,
 * dans une organisation donnée.
 */
async function findGroupById(
  groupId,
  tenantId
) {
  const result = await database.query(
    `
      SELECT
        id,
        tenant_id,
        name,
        created_by,
        created_at

      FROM groups

      WHERE id = $1
        AND tenant_id = $2

      LIMIT 1
    `,
    [
      groupId,
      tenantId,
    ]
  );

  return result.rows[0] || null;
}

/**
 * Retourne les utilisateurs appartenant
 * à un groupe du tenant.
 */
async function listGroupMembers(
  groupId,
  tenantId
) {
  const result = await database.query(
    `
      SELECT
        users.id,
        users.email,
        users.role,
        group_members.created_at

      FROM groups

      INNER JOIN group_members
        ON group_members.group_id = groups.id

      INNER JOIN users
        ON users.id = group_members.user_id
        AND users.tenant_id = groups.tenant_id

      WHERE groups.id = $1
        AND groups.tenant_id = $2

      ORDER BY group_members.created_at ASC
    `,
    [
      groupId,
      tenantId,
    ]
  );

  return result.rows;
}

/**
 * Ajoute un utilisateur à un groupe.
 *
 * L'ajout est accepté uniquement si :
 * - le groupe appartient au tenant ;
 * - l'utilisateur appartient au même tenant ;
 * - le groupe contient moins de 3 membres ;
 * - l'utilisateur n'est pas déjà membre.
 */
async function addGroupMember({
  groupId,
  userId,
  tenantId,
}) {
  const result = await database.query(
    `
      INSERT INTO group_members (
        group_id,
        user_id
      )

      SELECT
        groups.id,
        users.id

      FROM groups

      INNER JOIN users
        ON users.id = $2
        AND users.tenant_id = groups.tenant_id

      WHERE groups.id = $1
        AND groups.tenant_id = $3
        AND (
          SELECT COUNT(*)
          FROM group_members
          WHERE group_members.group_id = groups.id
        ) < 3

      ON CONFLICT (
        group_id,
        user_id
      )
      DO NOTHING

      RETURNING
        group_id,
        user_id,
        created_at
    `,
    [
      groupId,
      userId,
      tenantId,
    ]
  );

  return result.rows[0] || null;
}

/**
 * Retire un utilisateur d'un groupe.
 */
async function removeGroupMember({
  groupId,
  userId,
  tenantId,
}) {
  const result = await database.query(
    `
      DELETE FROM group_members

      USING groups

      WHERE group_members.group_id = groups.id
        AND group_members.group_id = $1
        AND group_members.user_id = $2
        AND groups.tenant_id = $3

      RETURNING
        group_members.group_id,
        group_members.user_id
    `,
    [
      groupId,
      userId,
      tenantId,
    ]
  );

  return result.rows[0] || null;
}

/**
 * Supprime un groupe appartenant à un tenant.
 *
 * Les lignes de group_members sont supprimées
 * automatiquement grâce à ON DELETE CASCADE.
 */
async function deleteGroupByIdAndTenantId({
  groupId,
  tenantId,
}) {
  const result = await database.query(
    `
      DELETE FROM groups

      WHERE id = $1
        AND tenant_id = $2

      RETURNING
        id,
        tenant_id,
        name,
        created_by
    `,
    [
      groupId,
      tenantId,
    ]
  );

  return result.rows[0] || null;
}
/**
 * Liste uniquement les groupes auxquels
 * un utilisateur appartient.
 */
async function listGroupsByUserId(
  tenantId,
  userId
) {
  if (!tenantId || !userId) {
    throw new Error(
      'Le tenant et l’utilisateur sont obligatoires.'
    );
  }

  const result = await database.query(
    `
      SELECT
        groups.id,
        groups.tenant_id,
        groups.name,
        groups.created_by,
        groups.created_at,

        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', users.id,
              'email', users.email,
              'role', users.role,
              'createdAt', group_members.created_at
            )
            ORDER BY group_members.created_at ASC
          ) FILTER (
            WHERE users.id IS NOT NULL
          ),
          '[]'::JSON
        ) AS members

      FROM groups

      LEFT JOIN group_members
        ON group_members.group_id = groups.id

      LEFT JOIN users
        ON users.id = group_members.user_id
        AND users.tenant_id = groups.tenant_id

      WHERE groups.tenant_id = $1

        AND EXISTS (
          SELECT 1

          FROM group_members
            AS current_user_membership

          WHERE
            current_user_membership.group_id =
              groups.id

            AND current_user_membership.user_id =
              $2
        )

      GROUP BY groups.id

      ORDER BY groups.created_at ASC
    `,
    [
      tenantId,
      userId,
    ]
  );

  return result.rows;
}
module.exports = {
  listGroupsByTenantId,
  listGroupsByUserId,
  createGroup,
  findGroupById,
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  deleteGroupByIdAndTenantId,
};