const express = require('express');

const validationMiddleware = require('../middleware/validation.middleware');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', validationMiddleware.validateLogin, authController.login);

router.post(
  '/logout',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authController.logout
);

router.get(
  '/me',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authController.getCurrentUser
);

router.patch(
  '/password',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  validationMiddleware.validatePasswordChange,
  authController.changePassword
);

module.exports = router;
