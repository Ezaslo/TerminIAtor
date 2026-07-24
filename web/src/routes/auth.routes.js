const express = require('express');

const validationMiddleware = require('../middleware/validation.middleware');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const mfaController = require('../controllers/mfa.controller');

const router = express.Router();

router.get('/mfa/status', authMiddleware.authenticate, authMiddleware.requireAuthentication, mfaController.getMfaStatus);
router.post('/mfa/setup', authMiddleware.authenticate, authMiddleware.requireAuthentication, mfaController.setupMfa);
router.post('/mfa/confirm', authMiddleware.authenticate, authMiddleware.requireAuthentication, validationMiddleware.validateMfaCode, mfaController.confirmMfa);
router.post('/mfa/verify', validationMiddleware.validateMfaChallenge, validationMiddleware.validateMfaCode, mfaController.verifyMfa);
router.post('/mfa/recovery', validationMiddleware.validateRecoveryLogin, mfaController.useRecoveryCode);
router.delete('/mfa', authMiddleware.authenticate, authMiddleware.requireAuthentication, validationMiddleware.validateDisableMfa, mfaController.disableMfa);

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
