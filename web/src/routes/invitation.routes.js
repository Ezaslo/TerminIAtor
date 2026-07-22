const express = require('express');

const invitationController = require(
  '../controllers/invitation.controller'
);

const router = express.Router();

router.post(
  '/validate',
  invitationController.getInvitationDetails
);

router.post(
  '/accept',
  invitationController.acceptInvitation
);

module.exports = router;