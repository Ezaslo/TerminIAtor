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

module.exports = router;