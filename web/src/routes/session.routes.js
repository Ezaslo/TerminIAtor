const express = require('express');

const authMiddleware = require(
  '../middleware/auth.middleware'
);

const sessionController = require(
  '../controllers/session.controller'
);

const router = express.Router();

/**
 * Liste les sessions du tenant connecté.
 */
router.get(
  '/',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  sessionController.listSessions
);
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
module.exports = router;