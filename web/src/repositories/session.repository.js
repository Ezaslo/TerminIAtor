const fs = require('fs');
const crypto = require('crypto');

const config = require('../config/env');
const database = require('../database/database');

/**
 * Crée un état vide pour une session.
 *
 * @returns {object}
 */
function createEmptySessionState() {
  return {
    active: false,
    databaseSessionId: null,
    status: 'idle',
    workspaceName: null,
    workspaceSlug: null,
    accessUrl: null,
    instanceType: null,
    modelLabel: null,
    adminEmail: null,
    accessNotes: null,
    authMode: null,
    teamSizeHint: null,
    sessionTtlHours: null,
    createdAt: null,
    expiresAt: null,
  };
}

/**
 * Crée un état vide pour les informations sensibles.
 *
 * @returns {object}
 */
function createEmptySessionSecrets() {
  return {
    adminEmail: null,
    adminPassword: null,
    jwt: null,
    jwtExpiresAt: null,
    launchToken: null,
    launchTokenExpiresAt: null,
  };
}

// État de la session actuellement disponible.
const sessionState =
  createEmptySessionState();

// État utilisé pendant la création de la session.
const draftSessionState =
  createEmptySessionState();

// Informations sensibles associées à la session.
const sessionSecrets =
  createEmptySessionSecrets();

/**
 * Retourne l’état de la session active.
 *
 * @returns {object}
 */
function getSessionState() {
  return sessionState;
}

/**
 * Retourne l’état provisoire de la session.
 *
 * @returns {object}
 */
function getDraftSessionState() {
  return draftSessionState;
}

/**
 * Retourne les informations sensibles.
 *
 * @returns {object}
 */
function getSessionSecrets() {
  return sessionSecrets;
}

/**
 * Réinitialise un objet représentant une session.
 *
 * @param {object} target État à réinitialiser.
 */
function clearSessionState(target) {
  Object.assign(
    target,
    createEmptySessionState()
  );
}

/**
 * Réinitialise les informations sensibles.
 */
function clearSessionSecrets() {
  Object.assign(
    sessionSecrets,
    createEmptySessionSecrets()
  );
}

/**
 * Réinitialise tous les états de session.
 */
function clearAll() {
  clearSessionState(sessionState);
  clearSessionState(draftSessionState);
  clearSessionSecrets();
}

/**
 * Sauvegarde l’état actuel dans un fichier JSON.
 *
 * @param {(error: Error) => void} onError Fonction appelée en cas d’erreur.
 * @returns {boolean}
 */
function persistState(onError = null) {
  try {
    const content = JSON.stringify(
      {
        sessionState,
        draftSessionState,
        sessionSecrets,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    );

    fs.writeFileSync(
      config.stateFile,
      content,
      'utf8'
    );

    return true;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }

    return false;
  }
}

/**
 * Recharge l’état sauvegardé depuis le fichier JSON.
 *
 * @param {(error: Error) => void} onError Fonction appelée en cas d’erreur.
 * @returns {boolean}
 */
function loadPersistedState(onError = null) {
  try {
    if (!fs.existsSync(config.stateFile)) {
      return false;
    }

    const rawContent = fs.readFileSync(
      config.stateFile,
      'utf8'
    );

    const parsedContent =
      JSON.parse(rawContent);

    if (
      parsedContent.sessionState &&
      typeof parsedContent.sessionState === 'object'
    ) {
      Object.assign(
        sessionState,
        parsedContent.sessionState
      );
    }

    if (
      parsedContent.draftSessionState &&
      typeof parsedContent.draftSessionState === 'object'
    ) {
      Object.assign(
        draftSessionState,
        parsedContent.draftSessionState
      );
    }

    if (
      parsedContent.sessionSecrets &&
      typeof parsedContent.sessionSecrets === 'object'
    ) {
      Object.assign(
        sessionSecrets,
        parsedContent.sessionSecrets
      );
    }

    return true;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }

    return false;
  }
}

/**
 * Crée une nouvelle session dans PostgreSQL.
 *
 * @param {object} session Données de la session.
 * @returns {Promise<object>}
 */
async function createSession(session) {
  const id = crypto.randomUUID();

  const result = await database.query(
    `
      INSERT INTO sessions (
        id,
        tenant_id,
        created_by_user_id,
        name,
        slug,
        status,
        terraform_directory,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
      RETURNING *
    `,
    [
      id,
      session.tenantId,
      session.createdByUserId,
      session.name,
      session.slug,
      session.status || 'queued',
      session.terraformDirectory || null,
      session.expiresAt || null,
    ]
  );

  return result.rows[0];
}
/**
 * Retourne les sessions appartenant à un tenant.
 *
 * @param {string} tenantId Identifiant du tenant.
 * @returns {Promise<object[]>}
 */
async function listSessionsByTenantId(tenantId) {
  const result = await database.query(
    `
      SELECT
        id,
        tenant_id,
        created_by_user_id,
        name,
        slug,
        status,
        instance_id,
        elastic_ip,
        dns_name,
        access_url,
        terraform_directory,
        created_at,
        updated_at,
        expires_at,
        destroyed_at
      FROM sessions
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `,
    [
      tenantId,
    ]
  );

  return result.rows;
}
/**
 * Met à jour le statut d’une session PostgreSQL.
 *
 * @param {string} sessionId Identifiant de la session.
 * @param {string} status Nouveau statut.
 * @returns {Promise<object|null>}
 */
async function updateSessionStatus(
  sessionId,
  status
) {
  const result = await database.query(
    `
      UPDATE sessions
      SET
        status = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      sessionId,
      status,
    ]
  );

  return result.rows[0] || null;
}
/**
 * Marque une session PostgreSQL comme détruite.
 *
 * @param {string} sessionId Identifiant de la session.
 * @returns {Promise<object|null>}
 */
async function markSessionDestroyed(sessionId) {
  const result = await database.query(
    `
      UPDATE sessions
      SET
        status = 'destroyed',
        destroyed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      sessionId,
    ]
  );

  return result.rows[0] || null;
}
/**
 * Autorise un utilisateur à accéder à une session.
 *
 * @param {string} sessionId Identifiant de la session.
 * @param {string} userId Identifiant de l'utilisateur.
 * @returns {Promise<object>}
 */
async function addUserToSession(
  sessionId,
  userId
) {
  const result = await database.query(
    `
      INSERT INTO session_users (
        session_id,
        user_id
      )
      VALUES (
        $1,
        $2
      )
      ON CONFLICT (
        session_id,
        user_id
      )
      DO UPDATE SET
        user_id = EXCLUDED.user_id
      RETURNING *
    `,
    [
      sessionId,
      userId,
    ]
  );

  return result.rows[0];
}
/**
 * Vérifie qu'un utilisateur peut accéder à une session.
 *
 * @param {string} sessionId Identifiant de la session.
 * @param {string} userId Identifiant de l'utilisateur.
 * @param {string} tenantId Identifiant du tenant.
 * @returns {Promise<boolean>}
 */
async function canUserAccessSession(
  sessionId,
  userId,
  tenantId
) {
  const result = await database.query(
    `
      SELECT 1
      FROM session_users
      INNER JOIN sessions
        ON sessions.id = session_users.session_id
      WHERE session_users.session_id = $1
        AND session_users.user_id = $2
        AND sessions.tenant_id = $3
      LIMIT 1
    `,
    [
      sessionId,
      userId,
      tenantId,
    ]
  );

  return result.rowCount > 0;
}
module.exports = {
  addUserToSession,
  createSession,
  listSessionsByTenantId,
  getSessionState,
  markSessionDestroyed,
  getDraftSessionState,
  updateSessionStatus,
  canUserAccessSession,
  getSessionSecrets,
  clearSessionState,
  clearSessionSecrets,
  clearAll,
  persistState,
  loadPersistedState,
};