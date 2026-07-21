const invitationRepository = require(
  '../repositories/invitation.repository'
);

const invitationService = require(
  '../services/invitation.service'
);

/**
 * Vérifie qu'une invitation est encore valide.
 *
 * Cette route sera publique car l'utilisateur
 * invité ne possède pas encore de compte.
 */
async function getInvitationDetails(
  request,
  response,
  next
) {
  try {
    const token =
      typeof request.body?.token === 'string'
        ? request.body.token.trim()
        : '';

    if (!token) {
      return response.status(400).json({
        error:
          'Le jeton d’invitation est obligatoire.',
      });
    }

    const tokenHash =
      invitationService
        .hashInvitationToken(token);

    const invitation =
      await invitationRepository
        .findActiveInvitationByTokenHash(
          tokenHash
        );

    if (!invitation) {
      return response.status(404).json({
        error:
          'Cette invitation est invalide, expirée ou déjà utilisée.',
      });
    }

    return response.status(200).json({
      invitation: {
        email: invitation.email,
        role: invitation.role,

        tenant: {
          id: invitation.tenant_id,
          name: invitation.tenant_name,
          slug: invitation.tenant_slug,
        },

        createdAt:
          invitation.created_at,

        expiresAt:
          invitation.expires_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getInvitationDetails,
};