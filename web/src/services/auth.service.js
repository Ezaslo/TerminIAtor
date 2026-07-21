const crypto = require('crypto');

const DEFAULT_SESSION_DURATION_HOURS = 8;

/**
 * Calcule l'empreinte SHA-256 d'un jeton.
 *
 * C'est cette empreinte qui est enregistrée
 * dans PostgreSQL, jamais le jeton brut.
 */
function hashSessionToken(token) {
  if (
    typeof token !== 'string' ||
    token.length === 0
  ) {
    throw new Error(
      'Le jeton de session est obligatoire.'
    );
  }

  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

/**
 * Génère un nouveau jeton de connexion.
 */
function createSessionToken({
  durationHours =
    DEFAULT_SESSION_DURATION_HOURS,
} = {}) {
  if (
    !Number.isFinite(durationHours) ||
    durationHours <= 0
  ) {
    throw new Error(
      'La durée de session doit être positive.'
    );
  }

  const token = crypto
    .randomBytes(32)
    .toString('base64url');

  const tokenHash =
    hashSessionToken(token);

  const expiresAt = new Date(
    Date.now() +
      durationHours * 60 * 60 * 1000
  );

  return {
    token,
    tokenHash,
    expiresAt,
  };
}

/**
 * Compare un jeton reçu avec un hash enregistré.
 */
function verifySessionToken(
  token,
  expectedTokenHash
) {
  if (
    typeof token !== 'string' ||
    typeof expectedTokenHash !== 'string'
  ) {
    return false;
  }

  try {
    const actualTokenHash =
      hashSessionToken(token);

    const actualBuffer = Buffer.from(
      actualTokenHash,
      'hex'
    );

    const expectedBuffer = Buffer.from(
      expectedTokenHash,
      'hex'
    );

    if (
      actualBuffer.length !==
      expectedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    );
  } catch {
    return false;
  }
}

module.exports = {
  createSessionToken,
  hashSessionToken,
  verifySessionToken,
};