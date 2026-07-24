const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(
  crypto.scrypt
);

const ALGORITHM = 'scrypt';
const KEY_LENGTH = 64;

const SCRYPT_OPTIONS = {
  N: 2 ** 15,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
};

/**
 * Vérifie que le mot de passe peut être traité.
 */
function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length === 0
  ) {
    throw new Error(
      'Le mot de passe est obligatoire.'
    );
  }

  if (
    Buffer.byteLength(
      password,
      'utf8'
    ) > 1024
  ) {
    throw new Error(
      'Le mot de passe est trop long.'
    );
  }
}

/**
 * Transforme un mot de passe en hash sécurisé.
 *
 * Le résultat contient :
 * - l’algorithme ;
 * - les paramètres scrypt ;
 * - le sel aléatoire ;
 * - le hash.
 */
async function hashPassword(password) {
  validatePassword(password);

  const salt = crypto.randomBytes(16);

  const derivedKey = await scryptAsync(
    password,
    salt,
    KEY_LENGTH,
    SCRYPT_OPTIONS
  );

  return [
    ALGORITHM,
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

/**
 * Compare un mot de passe avec un hash enregistré.
 */
async function verifyPassword(
  password,
  storedHash
) {
  if (
    typeof password !== 'string' ||
    typeof storedHash !== 'string'
  ) {
    return false;
  }

  const parts = storedHash.split('$');

  if (parts.length !== 6) {
    return false;
  }

  const [
    algorithm,
    costText,
    blockSizeText,
    parallelizationText,
    saltText,
    expectedHashText,
  ] = parts;

  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(
    parallelizationText
  );

  if (
    algorithm !== ALGORITHM ||
    cost !== SCRYPT_OPTIONS.N ||
    blockSize !== SCRYPT_OPTIONS.r ||
    parallelization !== SCRYPT_OPTIONS.p
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(
      saltText,
      'base64url'
    );

    const expectedHash = Buffer.from(
      expectedHashText,
      'base64url'
    );

    const actualHash = await scryptAsync(
      password,
      salt,
      expectedHash.length,
      SCRYPT_OPTIONS
    );

    if (
      actualHash.length !==
      expectedHash.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      actualHash,
      expectedHash
    );
  } catch {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
};