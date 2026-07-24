const config = require(
  '../config/env'
);

const userRepository = require(
  '../repositories/user.repository'
);

const authSessionRepository = require(
  '../repositories/auth-session.repository'
);

const passwordService = require(
  '../services/password.service'
);

const authService = require(
  '../services/auth.service'
);

/**
 * Connecte un utilisateur au portail.
 */
async function login(
  request,
  response,
  next
) {
  try {
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email
            .trim()
            .toLowerCase()
        : '';

    const password =
      typeof request.body?.password === 'string'
        ? request.body.password
        : '';

    if (!email || !password) {
      return response.status(400).json({
        error:
          'L’email et le mot de passe sont obligatoires.',
      });
    }

    const user =
      await userRepository.findUserByEmail(
        email
      );

    const passwordIsValid =
      user
        ? await passwordService.verifyPassword(
            password,
            user.password_hash
          )
        : false;

    if (!user || !passwordIsValid) {
      return response.status(401).json({
        error: 'Identifiants invalides.',
      });
    }

    const sessionToken =
      authService.createSessionToken({
        durationHours:
          config.auth.sessionDurationHours,
      });

    await authSessionRepository
      .createAuthSession({
        userId: user.id,
        tokenHash:
          sessionToken.tokenHash,
        expiresAt:
          sessionToken.expiresAt,
        ipAddress:
          request.ip || null,
        userAgent:
          request.get('user-agent') ||
          null,
      });

    response.cookie(
      config.auth.cookieName,
      sessionToken.token,
      {
        httpOnly: true,
        secure:
          config.auth.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge:
          config.auth
            .sessionDurationHours *
          60 *
          60 *
          1000,
      }
    );

    return response.status(200).json({
      message: 'Connexion réussie.',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
      },
      expiresAt:
        sessionToken.expiresAt,
    });
  } catch (error) {
    return next(error);
  }
}
/**
 * Renvoie l’utilisateur actuellement connecté.
 */
function getCurrentUser(
  request,
  response
) {
  return response.status(200).json({
    user: {
      id: request.auth.userId,
      email: request.auth.email,
      role: request.auth.role,
      tenantId: request.auth.tenantId,
      tenantName: request.auth.tenantName,
      tenantSlug: request.auth.tenantSlug,
    },
    session: {
      id: request.auth.sessionId,
      expiresAt: request.auth.expiresAt,
    },
  });
}
/**
 * Déconnecte l’utilisateur actuellement connecté.
 */
async function logout(
  request,
  response,
  next
) {
  try {
    await authSessionRepository
      .revokeAuthSessionById(
        request.auth.sessionId
      );

    response.clearCookie(
      config.auth.cookieName,
      {
        httpOnly: true,
        secure:
          config.auth.secureCookies,
        sameSite: 'lax',
        path: '/',
      }
    );

    return response.status(200).json({
      message: 'Déconnexion réussie.',
    });
  } catch (error) {
    return next(error);
  }
}

async function changePassword(request, response, next) {
  try {
    const { currentPassword, newPassword } = request.body;
    const user = await userRepository.findUserCredentialsById(request.auth.userId);

    if (!user) return response.status(404).json({ error: 'Utilisateur introuvable.' });
    if (!await passwordService.verifyPassword(currentPassword, user.password_hash)) {
      return response.status(401).json({ error: 'Le mot de passe actuel est incorrect.' });
    }
    if (await passwordService.verifyPassword(newPassword, user.password_hash)) {
      return response.status(400).json({ error: 'Le nouveau mot de passe doit être différent du mot de passe actuel.' });
    }

    const newPasswordHash = await passwordService.hashPassword(newPassword);
    const updatedUser = await userRepository.updatePasswordHashById({
      userId: request.auth.userId,
      passwordHash: newPasswordHash
    });
    if (!updatedUser) return response.status(404).json({ error: 'Impossible de mettre à jour le mot de passe.' });

    const revokedSessions = await authSessionRepository.revokeOtherAuthSessionsByUserId({
      userId: request.auth.userId,
      currentSessionId: request.auth.sessionId
    });
    return response.status(200).json({
      message: 'Mot de passe modifié avec succès.',
      revokedSessions: revokedSessions.length
    });
  } catch (error) {
    return next(error);
  }
}
module.exports = {
  login,
  logout,
  getCurrentUser,
  changePassword,
};
