const sessionRepository = require(
  '../repositories/session.repository'
);

/**
 * Liste uniquement les sessions accessibles par l’utilisateur connecté.
 */
async function listSessions(
  request,
  response
) {
  try {
    const sessions =
      await sessionRepository.listSessionsForUser(
        request.auth.userId,
        request.auth.tenantId,
        false
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