const crypto = require('crypto');
process.env.MFA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const { generateSync } = require('otplib');
const { generateTotpSecret, verifyTotpCode } = require('../src/services/mfa.service');

const secret = generateTotpSecret();
const validCode = generateSync({ secret, algorithm: 'sha1', digits: 6, period: 30 });
const invalidCode = validCode === '999999' ? '888888' : '999999';
const validAccepted = verifyTotpCode(secret, validCode) === true;
const invalidRejected = verifyTotpCode(secret, invalidCode) === false;
const invalidTextRejected = verifyTotpCode(secret, 'abcdef') === false;
const emptyRejected = verifyTotpCode(secret, '') === false;
const booleanResult = [validCode, invalidCode, 'abcdef', ''].every((code) => typeof verifyTotpCode(secret, code) === 'boolean');

console.log(`code valide accepté : ${validAccepted ? 'oui' : 'non'}`);
console.log(`code invalide refusé : ${invalidRejected && invalidTextRejected && emptyRejected ? 'oui' : 'non'}`);
console.log(`type du résultat : ${booleanResult ? 'boolean' : 'autre'}`);
if (!validAccepted || !invalidRejected || !invalidTextRejected || !emptyRejected || !booleanResult) process.exitCode = 1;
