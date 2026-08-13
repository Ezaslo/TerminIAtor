const invitationRepository = require(
  '../repositories/invitation.repository'
);

const invitationService = require(
  '../services/invitation.service'
);

const invitationAcceptanceService = require(
  '../services/invitation-acceptance.service'
);

const passwordService = require(
  '../services/password.service'
);

/**
 * Vérifie qu'une invitation est encore valide.
 */
async function getInvitationDetails(
  request,
  response,
  next
) {
  try {
    const { token } = request.body;

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

/**
 * Accepte une invitation et crée
 * le compte de l'utilisateur.
 */
async function acceptInvitation(
  request,
  response,
  next
) {
  try {
    const { token, password } = request.body;

    const tokenHash =
      invitationService
        .hashInvitationToken(token);

    const passwordHash =
      await passwordService
        .hashPassword(password);

    const result =
      await invitationAcceptanceService
        .acceptInvitationAndCreateUser({
          tokenHash,
          passwordHash,
        });

    if (!result) {
      return response.status(404).json({
        error:
          'Cette invitation est invalide, expirée ou déjà utilisée.',
      });
    }

    return response.status(201).json({
      message:
        'Votre compte a été créé avec succès.',

      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        tenantId: result.user.tenant_id,
        createdAt: result.user.created_at,
      },

      tenant: result.tenant,
    });
  } catch (error) {
    if (
      error.code ===
      'EMAIL_ALREADY_EXISTS'
    ) {
      return response.status(409).json({
        error:
          'Un compte existe déjà pour cette adresse email.',
      });
    }

    return next(error);
  }
}

module.exports = {
  getInvitationDetails,
  acceptInvitation,
};
