const emailService = require(
  '../services/email.service'
);

const userRepository = require(
  '../repositories/user.repository'
);

const invitationRepository = require(
  '../repositories/invitation.repository'
);
const passwordService = require(
  '../services/password.service'
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
/**
 * Liste les invitations encore actives
 * pour l’organisation connectée.
 */
async function listInvitations(
  request,
  response,
  next
) {
  try {
    const invitations =
      await invitationRepository
        .listPendingInvitationsByTenantId(
          request.auth.tenantId
        );

    return response.status(200).json({
      count: invitations.length,

      invitations: invitations.map(
        (invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          invitedByEmail:
            invitation.invited_by_email,
          createdAt:
            invitation.created_at,
          expiresAt:
            invitation.expires_at,
        })
      ),
    });
  } catch (error) {
    return next(error);
  }
}
/**
 * Supprime un utilisateur de l’organisation connectée.
 */
async function deleteUser(
  request,
  response,
  next
) {
  try {
    const userId =
      typeof request.params?.userId ===
      'string'
        ? request.params.userId.trim()
        : '';

    if (!userId) {
      return response.status(400).json({
        error:
          'L’identifiant utilisateur est obligatoire.',
      });
    }

    if (
      userId === request.auth.userId
    ) {
      return response.status(400).json({
        error:
          'Tu ne peux pas supprimer ton propre compte.',
      });
    }

    const deletedUser =
      await userRepository
        .deleteUserByIdAndTenantId({
          userId,
          tenantId:
            request.auth.tenantId,
        });

    if (!deletedUser) {
      return response.status(404).json({
        error:
          'Utilisateur introuvable.',
      });
    }

    return response.status(200).json({
      message:
        'Utilisateur supprimé avec succès.',

      user: {
        id: deletedUser.id,
        email: deletedUser.email,
        role: deletedUser.role,
      },
    });
  } catch (error) {
    return next(error);
  }
}
/**
 * Réinitialise le mot de passe d’un utilisateur
 * appartenant à l’organisation connectée.
 */
async function resetUserPassword(
  request,
  response,
  next
) {
  try {
    const userId =
      typeof request.params?.userId ===
      'string'
        ? request.params.userId.trim()
        : '';

    const password =
      typeof request.body?.password ===
      'string'
        ? request.body.password
        : '';

    if (!userId) {
      return response.status(400).json({
        error:
          'L’identifiant utilisateur est obligatoire.',
      });
    }

    if (!password) {
      return response.status(400).json({
        error:
          'Le nouveau mot de passe est obligatoire.',
      });
    }

    const passwordHash =
      await passwordService
        .hashPassword(password);

    const updatedUser =
      await userRepository
        .updateUserPassword({
          userId,
          tenantId:
            request.auth.tenantId,
          passwordHash,
        });

    if (!updatedUser) {
      return response.status(404).json({
        error:
          'Utilisateur introuvable.',
      });
    }
    await emailService.sendPasswordEmail({
  to: updatedUser.email,
  password,
});

    return response.status(200).json({
      message:
        'Mot de passe réinitialisé avec succès.',

      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    return next(error);
  }
}
module.exports = {
  listUsers,
  deleteUser,
  resetUserPassword,
  listInvitations,
  createInvitation,
};