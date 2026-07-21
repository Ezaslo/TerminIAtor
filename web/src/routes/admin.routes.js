const express = require('express');

const adminController = require(
  '../controllers/admin.controller'
);

const authMiddleware = require(
  '../middleware/auth.middleware'
);

const router = express.Router();

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

  adminController.createInvitation
);
module.exports = router;