const express = require('express');

const invitationController = require(
  '../controllers/invitation.controller'
);

const validationMiddleware = require(
  '../middleware/validation.middleware'
);

const router = express.Router();

router.post(
  '/validate',
  validationMiddleware.validateInvitationToken,
  invitationController.getInvitationDetails
);

router.post(
  '/accept',
  validationMiddleware.validateInvitationAcceptance,
  invitationController.acceptInvitation
);

module.exports = router;
