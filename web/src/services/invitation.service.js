const crypto = require('crypto');

const DEFAULT_INVITATION_DURATION_HOURS = 24;

/**
 * Calcule le hash SHA-256 d’un jeton
 * d’invitation.
 */
function hashInvitationToken(token) {
  if (
    typeof token !== 'string' ||
    token.length === 0
  ) {
    throw new Error(
      'Le jeton d’invitation est obligatoire.'
    );
  }

  return crypto
    .createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

/**
 * Génère un jeton secret d’invitation,
 * son hash et sa date d’expiration.
 */
function createInvitationToken({
  durationHours =
    DEFAULT_INVITATION_DURATION_HOURS,
} = {}) {
  const numericDuration =
    Number(durationHours);

  if (
    !Number.isFinite(numericDuration) ||
    numericDuration <= 0
  ) {
    throw new Error(
      'La durée de l’invitation doit être positive.'
    );
  }

  const token = crypto
    .randomBytes(32)
    .toString('base64url');

  const tokenHash =
    hashInvitationToken(token);

  const expiresAt = new Date(
    Date.now() +
      numericDuration *
        60 *
        60 *
        1000
  );

  return {
    token,
    tokenHash,
    expiresAt,
  };
}

module.exports = {
  createInvitationToken,
  hashInvitationToken,
};