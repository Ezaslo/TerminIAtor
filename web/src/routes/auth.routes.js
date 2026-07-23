const express = require('express');

const validationMiddleware = require(
  '../middleware/validation.middleware'
);

const authController = require(
  '../controllers/auth.controller'
);

const authMiddleware = require(
  '../middleware/auth.middleware'
);

const router = express.Router();

router.post(
  '/login',
  validationMiddleware.validateLogin,
  authController.login
);
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_INVITATION_ROLES = new Set(['admin', 'member']);

function validateInvitationCreation(req, res, next) {
  const email =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

  const role =
    typeof req.body?.role === 'string'
      ? req.body.role.trim().toLowerCase()
      : '';

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      error: 'L’adresse email est invalide.'
    });
  }

  if (!ALLOWED_INVITATION_ROLES.has(role)) {
    return res.status(400).json({
      error: 'Le rôle doit être admin ou member.'
    });
  }

  req.body.email = email;
  req.body.role = role;

  return next();
}

function validateInvitationAcceptance(req, res, next) {
  const token =
    typeof req.body?.token === 'string'
      ? req.body.token.trim()
      : '';

  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : '';

  if (!token) {
    return res.status(400).json({
      error: 'Le jeton d’invitation est obligatoire.'
    });
  }

  if (password.length < 12 || password.length > 200) {
    return res.status(400).json({
      error: 'Le mot de passe doit contenir entre 12 et 200 caractères.'
    });
  }

  req.body.token = token;
  req.body.password = password;

  return next();
}

module.exports = router;