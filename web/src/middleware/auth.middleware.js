const config = require(
  '../config/env'
);

const authService = require(
  '../services/auth.service'
);

const authSessionRepository = require(
  '../repositories/auth-session.repository'
);

/**
 * Lit la valeur d’un cookie depuis
 * l’en-tête HTTP Cookie.
 */
function getCookieValue(
  request,
  cookieName
) {
  const cookieHeader =
    request.headers.cookie || '';

  const prefix = `${cookieName}=`;

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) =>
      part.startsWith(prefix)
    );

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(
      cookie.slice(prefix.length)
    );
  } catch {
    return null;
  }
}

/**
 * Recherche éventuellement l’utilisateur connecté.
 *
 * Cette fonction ne bloque pas la requête si
 * aucun utilisateur n’est connecté.
 */
async function authenticate(
  request,
  response,
  next
) {
  try {
    request.auth = null;

    const token = getCookieValue(
      request,
      config.auth.cookieName
    );

    if (!token) {
      return next();
    }

    const tokenHash =
      authService.hashSessionToken(token);

    const authSession =
      await authSessionRepository
        .findActiveSessionByTokenHash(
          tokenHash
        );

    if (!authSession) {
      return next();
    }

    request.auth = {
      sessionId: authSession.id,
      userId: authSession.user_id,
      tenantId: authSession.tenant_id,
      email: authSession.email,
      role: authSession.role,
      tenantName:
        authSession.tenant_name,
      tenantSlug:
        authSession.tenant_slug,
      expiresAt:
        authSession.expires_at,
    };

    await authSessionRepository
      .touchAuthSession(
        authSession.id
      );

    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Refuse l’accès si aucun utilisateur
 * n’est connecté.
 */
function requireAuthentication(
  request,
  response,
  next
) {
  if (!request.auth) {
    return response.status(401).json({
      error:
        'Authentification requise.',
    });
  }

  return next();
}

/**
 * Refuse l’accès si le rôle de
 * l’utilisateur n’est pas autorisé.
 */
function requireRole(
  ...allowedRoles
) {
  return function roleMiddleware(
    request,
    response,
    next
  ) {
    if (!request.auth) {
      return response.status(401).json({
        error:
          'Authentification requise.',
      });
    }

    if (
      !allowedRoles.includes(
        request.auth.role
      )
    ) {
      return response.status(403).json({
        error:
          'Vous n’avez pas les droits nécessaires.',
      });
    }

    return next();
  };
}

module.exports = {
  authenticate,
  requireAuthentication,
  requireRole,
};