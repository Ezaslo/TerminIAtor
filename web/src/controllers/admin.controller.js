const userRepository = require(
  '../repositories/user.repository'
);

const invitationRepository = require(
  '../repositories/invitation.repository'
);

const invitationService = require(
  '../services/invitation.service'
);

const ALLOWED_INVITATION_ROLES =
  new Set([
    'admin',
    'member',
  ]);

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

/**
 * Crée une invitation pour rejoindre
 * l’organisation de l’administrateur connecté.
 */
async function createInvitation(
  request,
  response,
  next
) {
  try {
    const email =
      typeof request.body?.email ===
      'string'
        ? request.body.email
            .trim()
            .toLowerCase()
        : '';

    const role =
      typeof request.body?.role ===
      'string'
        ? request.body.role.trim()
        : '';

    if (
      !EMAIL_PATTERN.test(email)
    ) {
      return response.status(400).json({
        error:
          'L’adresse email est invalide.',
      });
    }

    if (
      !ALLOWED_INVITATION_ROLES.has(
        role
      )
    ) {
      return response.status(400).json({
        error:
          'Le rôle doit être admin ou member.',
      });
    }

    const existingUser =
      await userRepository
        .findUserByEmail(email);

    if (existingUser) {
      return response.status(409).json({
        error:
          'Un compte existe déjà pour cette adresse email.',
      });
    }

    const pendingInvitation =
      await invitationRepository
        .findPendingInvitationByEmail({
          tenantId:
            request.auth.tenantId,
          email,
        });

    if (pendingInvitation) {
      return response.status(409).json({
        error:
          'Une invitation active existe déjà pour cette adresse email.',
      });
    }

    const invitationToken =
      invitationService
        .createInvitationToken({
          durationHours: 24,
        });

    const invitation =
      await invitationRepository
        .createInvitation({
          tenantId:
            request.auth.tenantId,

          invitedByUserId:
            request.auth.userId,

          email,
          role,

          tokenHash:
            invitationToken.tokenHash,

          expiresAt:
            invitationToken.expiresAt,
        });

    const acceptancePath =
      `/accept-invitation.html?token=${
        encodeURIComponent(
          invitationToken.token
        )
      }`;

    return response.status(201).json({
      message:
        'Invitation créée avec succès.',

      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        createdAt:
          invitation.created_at,
        expiresAt:
          invitation.expires_at,
        acceptancePath,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
  createInvitation,
};