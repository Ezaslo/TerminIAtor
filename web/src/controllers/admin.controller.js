const userRepository = require(
  '../repositories/user.repository'
);

/**
 * Renvoie les utilisateurs appartenant
 * à l’organisation actuellement connectée.
 */
async function listUsers(
  request,
  response,
  next
) {
  try {
    const users =
      await userRepository
        .listUsersByTenantId(
          request.auth.tenantId
        );

    return response.status(200).json({
      tenant: {
        id: request.auth.tenantId,
        name: request.auth.tenantName,
        slug: request.auth.tenantSlug,
      },

      count: users.length,

      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
};