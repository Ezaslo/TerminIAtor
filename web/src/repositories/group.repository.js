const database = require('../database/database');

/**
 * Retourne les utilisateurs appartenant à un groupe du tenant.
 */
async function listGroupMembers(groupId, tenantId) {
  const result = await database.query(
    `
      SELECT users.id
      FROM groups
      INNER JOIN group_members
        ON group_members.group_id = groups.id
      INNER JOIN users
        ON users.id = group_members.user_id
      WHERE groups.id = $1
        AND groups.tenant_id = $2
      ORDER BY group_members.created_at ASC
    `,
    [groupId, tenantId]
  );

  return result.rows;
}
async function findGroupById(groupId, tenantId) {
  const result = await database.query(
    `
      SELECT id, tenant_id, name, created_by, created_at
      FROM groups
      WHERE id = $1
        AND tenant_id = $2
      LIMIT 1
    `,
    [groupId, tenantId]
  );

  return result.rows[0] ?? null;
}
module.exports = {
  findGroupById,
  listGroupMembers,
};