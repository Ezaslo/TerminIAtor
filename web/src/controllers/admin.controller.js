const userRepository = require(
  '../repositories/user.repository'
);

const invitationRepository = require(
  '../repositories/invitation.repository'
);
const passwordService = require(
  '../services/password.service'
);
const authSessionRepository = require('../repositories/auth-session.repository');
const usageRepository = require('../repositories/usage.repository');

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
        monthlyQuotaHours:
  user.monthly_quota_hours === null
    ? null
    : Number(user.monthly_quota_hours),
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
      typeof request.body?.newPassword ===
      'string'
        ? request.body.newPassword
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

    const targetUser = await userRepository.findUserById(userId);
    if (!targetUser) return response.status(404).json({ error: 'Utilisateur introuvable.' });
    if (targetUser.tenant_id !== request.auth.tenantId) return response.status(403).json({ error: 'Accès refusé.' });

    const passwordHash =
      await passwordService
        .hashPassword(password);

    const updatedUser =
      await userRepository
        .updatePasswordHashById({
          userId,
          passwordHash,
        });

    if (!updatedUser) {
      return response.status(404).json({
        error:
          'Utilisateur introuvable.',
      });
    }
    await authSessionRepository.revokeAllAuthSessionsByUserId({ userId });

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
async function updateUserQuota(
  request,
  response,
  next
) {
  try {
    const userId =
      typeof request.params?.userId === 'string'
        ? request.params.userId.trim()
        : '';

    const rawQuota =
      request.body?.monthlyQuotaHours;

    let monthlyQuotaHours = null;

    if (
      rawQuota !== null &&
      rawQuota !== undefined &&
      rawQuota !== ''
    ) {
      monthlyQuotaHours =
        Number.parseInt(String(rawQuota), 10);

      if (
        !Number.isInteger(monthlyQuotaHours) ||
        monthlyQuotaHours < 0 ||
        monthlyQuotaHours > 744
      ) {
        return response.status(400).json({
          error:
            'Le quota mensuel doit être compris entre 0 et 744 heures, ou être vide pour un quota illimité.',
        });
      }
    }

    const updatedUser =
      await userRepository
        .updateMonthlyQuotaByIdAndTenantId({
          userId,
          tenantId: request.auth.tenantId,
          monthlyQuotaHours,
        });

    if (!updatedUser) {
      return response.status(404).json({
        error: 'Utilisateur introuvable.',
      });
    }

    return response.status(200).json({
      ok: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        monthlyQuotaHours:
          updatedUser.monthly_quota_hours === null
            ? null
            : Number(
                updatedUser.monthly_quota_hours
              ),
      },
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Renvoie la consommation machine du tenant sur une période.
 * Une session représente une seule machine facturable, même si plusieurs
 * membres d'un groupe y accèdent.
 */

async function listUsage(
  request,
  response,
  next
) {
  try {
    const now = new Date();
    const defaultFrom = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );
    const defaultTo = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1
    );

    const from = request.query?.from
      ? new Date(request.query.from)
      : defaultFrom;

    const to = request.query?.to
      ? new Date(request.query.to)
      : defaultTo;

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from
    ) {
      return response.status(400).json({
        error: 'Période de consommation invalide.',
      });
    }

    const maxRangeMs =
      370 * 24 * 60 * 60 * 1000;

    if (to.getTime() - from.getTime() > maxRangeMs) {
      return response.status(400).json({
        error: 'La période maximale est de 370 jours.',
      });
    }

    const sessions =
      await usageRepository.listTenantUsage(
        request.auth.tenantId,
        from.toISOString(),
        to.toISOString()
      );

    const normalizedSessions = sessions.map((session) => {
      const billableSeconds = Number(session.billable_seconds || 0);
      const usageSeconds = Number(
      session.usage_seconds || 0
);
      const fallbackGroupBilling =
        session.session_mode === 'team' &&
        Boolean(session.group_id);

      const payerType =
        session.billing_owner_type ||
        (fallbackGroupBilling ? 'group' : 'user');

      const payerId =
        session.billing_owner_id ||
        (payerType === 'group'
          ? session.group_id
          : session.created_by_user_id);

      const payerName =
        session.billing_owner_name ||
        (payerType === 'group'
          ? session.group_name || 'Groupe supprimé'
          : session.creator_email || 'Utilisateur supprimé');
      const monthlyQuotaHours =
      payerType === 'group'
      ? session.group_monthly_quota_hours
      : session.creator_monthly_quota_hours;

      return {
        id: session.id,
        name: session.name,
        status: session.status,
        payerType,
        payerId,
        payerName,
        creatorEmail: session.creator_email || null,
        groupName: session.group_name || null,
        machineFlavor: session.machine_flavor || null,
        machineStartedAt: session.machine_started_at,
        readyAt: session.ready_at,
        billingEndedAt:
          session.billing_ended_at ||
          session.destroyed_at ||
          null,
        periodStartedAt: session.period_started_at,
        periodEndedAt: session.period_ended_at,
        billableSeconds,
        authorizedUserCount:
          Number(session.authorized_user_count || 0),
        accessCount:
          Number(session.access_count || 0),
        participants:
          Array.isArray(session.participants)
            ? session.participants
            : [],
            usageSeconds,

monthlyQuotaHours:
  monthlyQuotaHours === null ||
  monthlyQuotaHours === undefined
    ? null
    : Number(monthlyQuotaHours),
      };
    });

    const payerMap = new Map();
    let totalBillableSeconds = 0;
    let activeMachines = 0;

    for (const session of normalizedSessions) {
      totalBillableSeconds += session.billableSeconds;

      if (!session.billingEndedAt) {
        activeMachines += 1;
      }

      const payerKey =
        `${session.payerType}:${session.payerId || session.payerName}`;

      if (!payerMap.has(payerKey)) {
        payerMap.set(payerKey, {
          usageSeconds: 0,
          monthlyQuotaHours: session.monthlyQuotaHours,
          payerType: session.payerType,
          payerId: session.payerId || null,
          payerName: session.payerName,
          billableSeconds: 0,
          sessionCount: 0,
        });
      }

      const payer = payerMap.get(payerKey);
      payer.billableSeconds += session.billableSeconds;
      payer.usageSeconds += session.usageSeconds;
      payer.sessionCount += 1;
    }

    const payers = Array.from(payerMap.values())
  .map((payer) => {
    const usedHours =
      payer.usageSeconds / 3600;

    return {
      ...payer,
      usedHours,
      remainingHours:
        payer.monthlyQuotaHours === null
          ? null
          : Math.max(
              0,
              payer.monthlyQuotaHours - usedHours
            ),
    };
  })
  .sort(
        (left, right) =>
          right.billableSeconds - left.billableSeconds
      );

    return response.status(200).json({
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      totals: {
        billableSeconds: totalBillableSeconds,
        sessionCount: normalizedSessions.length,
        activeMachines,
      },
      payers,
      sessions: normalizedSessions,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listUsers,
  deleteUser,
  resetUserPassword,
  updateUserQuota,
  listInvitations,
  createInvitation,
  listUsage,
};
