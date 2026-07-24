const express = require('express');

const adminController = require(
  '../controllers/admin.controller'
);

const authMiddleware = require(
  '../middleware/auth.middleware'
);

const router = express.Router();

const validationMiddleware = require(
  '../middleware/validation.middleware'
);

router.get(
  '/users',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  adminController.listUsers
);
router.post(
  '/invitations',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  validationMiddleware.validateInvitationCreation,

  adminController.createInvitation
);
router.get(
  '/invitations',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  adminController.listInvitations
);
router.delete(
  '/users/:userId',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  adminController.deleteUser
);
router.patch(
  '/users/:userId/password',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  validationMiddleware.validateAdminPasswordReset,

  adminController.resetUserPassword
);
module.exports = router;
