const sessionRepository = require(
  '../repositories/session.repository'
);

/**
 * Liste les sessions du tenant connecté.
 */
async function listSessions(
  request,
  response
) {
  try {
    const sessions =
      await sessionRepository.listSessionsByTenantId(
        request.auth.tenantId
      );

    return response.status(200).json({
      sessions,
    });
  } catch (error) {
    console.error(error);

    return response.status(500).json({
      error:
        'Impossible de récupérer les sessions.',
    });
  }
}

module.exports = {
  listSessions,
};