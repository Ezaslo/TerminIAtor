const crypto = require('crypto');
const database = require('../database/database');
function getExecutor(client) { return client || database; }

async function findUserMfaByUserId(userId, client) {
  const r = await getExecutor(client).query('SELECT * FROM user_mfa WHERE user_id = $1', [userId]); return r.rows[0] || null;
}
async function upsertPendingMfa({ userId, ciphertext, iv, authTag }, client) {
  const r = await getExecutor(client).query(`INSERT INTO user_mfa (user_id, totp_secret_ciphertext, totp_secret_iv, totp_secret_auth_tag, enabled, confirmed_at, updated_at) VALUES ($1,$2,$3,$4,FALSE,NULL,NOW()) ON CONFLICT (user_id) DO UPDATE SET totp_secret_ciphertext=$2, totp_secret_iv=$3, totp_secret_auth_tag=$4, enabled=CASE WHEN user_mfa.enabled THEN user_mfa.enabled ELSE FALSE END, confirmed_at=CASE WHEN user_mfa.enabled THEN user_mfa.confirmed_at ELSE NULL END, updated_at=NOW() RETURNING *`, [userId, ciphertext, iv, authTag]); return r.rows[0];
}
async function enableMfa(userId, client) { const r = await getExecutor(client).query('UPDATE user_mfa SET enabled=TRUE, confirmed_at=NOW(), updated_at=NOW() WHERE user_id=$1 AND enabled=FALSE RETURNING *', [userId]); return r.rows[0] || null; }
async function deleteUserMfa(userId, client) { await getExecutor(client).query('DELETE FROM user_mfa WHERE user_id=$1', [userId]); }
async function replaceRecoveryCodes({ userId, codeHashes }, client) { const e = getExecutor(client); await e.query('DELETE FROM user_mfa_recovery_codes WHERE user_id=$1', [userId]); for (const hash of codeHashes) await e.query('INSERT INTO user_mfa_recovery_codes (id,user_id,code_hash) VALUES ($1,$2,$3)', [crypto.randomUUID(), userId, hash]); }
async function createChallenge({ id, userId, challengeHash, purpose, expiresAt, ipAddress, userAgent, maxAttempts }, client) { const r = await getExecutor(client).query('INSERT INTO mfa_challenges (id,user_id,challenge_hash,purpose,expires_at,ip_address,user_agent,max_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id,userId,challengeHash,purpose,expiresAt,ipAddress || null,userAgent || null,maxAttempts]); return r.rows[0]; }
async function invalidateActiveChallenges({ userId, purpose }, client) { await getExecutor(client).query('UPDATE mfa_challenges SET consumed_at=NOW() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL', [userId,purpose]); }
async function findActiveChallengeForUpdate({ challengeHash, purpose }, client) { const r = await getExecutor(client).query('SELECT * FROM mfa_challenges WHERE challenge_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>NOW() AND attempts<max_attempts FOR UPDATE', [challengeHash,purpose]); return r.rows[0] || null; }
async function incrementChallengeAttempts(id, client) { const r = await getExecutor(client).query('UPDATE mfa_challenges SET attempts=attempts+1 WHERE id=$1 RETURNING attempts,max_attempts', [id]); return r.rows[0] || null; }
async function consumeChallenge(id, client) { const r = await getExecutor(client).query('UPDATE mfa_challenges SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL RETURNING *', [id]); return r.rows[0] || null; }
async function consumeRecoveryCode({ userId, codeHash }, client) { const r = await getExecutor(client).query('UPDATE user_mfa_recovery_codes SET used_at=NOW() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING *', [userId,codeHash]); return r.rows[0] || null; }
async function deleteRecoveryCodes(userId, client) { await getExecutor(client).query('DELETE FROM user_mfa_recovery_codes WHERE user_id=$1', [userId]); }
async function deleteExpiredChallenges(client) { const r = await getExecutor(client).query('DELETE FROM mfa_challenges WHERE expires_at<=NOW() OR consumed_at IS NOT NULL'); return r.rowCount; }
module.exports = { getExecutor, findUserMfaByUserId, upsertPendingMfa, enableMfa, deleteUserMfa, replaceRecoveryCodes, createChallenge, invalidateActiveChallenges, findActiveChallengeForUpdate, incrementChallengeAttempts, consumeChallenge, consumeRecoveryCode, deleteRecoveryCodes, deleteExpiredChallenges };
