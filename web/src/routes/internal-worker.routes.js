const express = require('express');

const {
  enrollWorker,
} = require(
  '../services/worker-enrollment.service'
);

const router = express.Router();

router.post(
  '/enroll',
  async (req, res) => {
    try {
      const result =
        await enrollWorker({
          instanceUuid:
            req.body?.instance_uuid,

          enrollmentToken:
            req.body?.enrollment_token,

          csrPem:
            req.body?.csr_pem,
        });

      res.setHeader(
        'Cache-Control',
        'no-store'
      );

      res.setHeader(
        'Pragma',
        'no-cache'
      );

      return res.status(200).json({
        server_cert_pem:
          result.serverCertPem,

        client_ca_pem:
          result.clientCaPem,
      });
    } catch (error) {
      const allowedStatusCodes =
        new Set([
          400,
          403,
          409,
          503,
        ]);

      const statusCode =
        allowedStatusCodes.has(
          error?.statusCode
        )
          ? error.statusCode
          : 500;

      if (statusCode >= 500) {
        console.error(
          '[worker-enrollment]',
          error?.message ||
            'Erreur inconnue'
        );
      }

      res.setHeader(
        'Cache-Control',
        'no-store'
      );

      return res
        .status(statusCode)
        .json({
          error:
            statusCode === 500
              ? 'Enrollment worker impossible.'
              : error.message,
        });
    }
  }
);

module.exports = router;