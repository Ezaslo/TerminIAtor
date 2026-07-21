const fs = require('fs');

const config = require('../config/env');

/**
 * Crée un état vide pour une session.
 *
 * @returns {object}
 */
function createEmptySessionState() {
  return {
    active: false,
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

module.exports = {
  getSessionState,
  getDraftSessionState,
  getSessionSecrets,
  clearSessionState,
  clearSessionSecrets,
  clearAll,
  persistState,
  loadPersistedState,
};