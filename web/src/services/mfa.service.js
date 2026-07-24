const crypto = require('crypto');
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const config = require('../config/env');

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTotpSecret() { return generateSecret(); }
function buildOtpAuthUri(email, secret) {
  return generateURI({ issuer: config.mfa.issuer, label: email, secret, algorithm: 'sha1', digits: 6, period: 30 });
}
function generateQrCodeDataUrl(uri) { return QRCode.toDataURL(uri, { type: 'image/png' }); }
function verifyTotpCode(secret, code) {
  if (
    typeof secret !== 'string' ||
    secret.length === 0 ||
    typeof code !== 'string' ||
    !/^\d{6}$/.test(code)
  ) {
    return false;
  }

  const result = verifySync({
    token: code,
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epochTolerance: 30,
  });

  return result.valid === true;
}
function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.mfa.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}
function decryptTotpSecret(ciphertext, iv, authTag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.mfa.encryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
function createChallengeToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashChallengeToken(token) { return crypto.createHash('sha256').update(token, 'utf8').digest('hex'); }
function normalizeRecoveryCode(code) {
  return typeof code === 'string' ? code.replace(/[\s-]/g, '').toUpperCase() : '';
}
function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(`terminiator:mfa-recovery:${normalizeRecoveryCode(code)}`, 'utf8').digest('hex');
}
function generateRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const bytes = crypto.randomBytes(7);
    let value = '';
    for (let i = 0; i < 10; i += 1) value += RECOVERY_ALPHABET[bytes[i % bytes.length] % RECOVERY_ALPHABET.length];
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

module.exports = { generateTotpSecret, buildOtpAuthUri, generateQrCodeDataUrl, verifyTotpCode, encryptTotpSecret, decryptTotpSecret, createChallengeToken, hashChallengeToken, normalizeRecoveryCode, hashRecoveryCode, generateRecoveryCodes };
