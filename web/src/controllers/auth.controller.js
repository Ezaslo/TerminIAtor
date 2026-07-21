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

module.exports = {
  login,
};