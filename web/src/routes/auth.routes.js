const express = require('express');

const authController = require(
  '../controllers/auth.controller'
);

const authMiddleware = require(
  '../middleware/auth.middleware'
);

const router = express.Router();

router.post(
  '/login',
  authController.login
);

router.get(
  '/me',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authController.getCurrentUser
);

module.exports = router;