const crypto = require('crypto');
const fs = require('fs');

const config = require('../config/env');
const sessionRepository = require(
  '../repositories/session.repository'
);
const openstackService = require(
  './openstack.service'
);
const {
  signWorkerCsr,
} = require(
  './worker-pki.service'
);

const ENROLLMENT_METADATA_KEY =
  'privalyse_enrollment_token';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOKEN_RE =
  /^[A-Za-z0-9_-]{43}$/;

const MAX_CSR_BYTES =
  16 * 1024;

function enrollmentError(
  message,
  statusCode
) {
  const error =
    new Error(message);

  error.statusCode =
    statusCode;

  return error;
}

function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(
      value,
      'utf8'
    )
    .digest('hex');
}

function constantTimeHexEqual(
  left,
  right
) {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(left) ||
    !/^[0-9a-f]{64}$/i.test(right)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(
      left,
      'hex'
    ),
    Buffer.from(
      right,
      'hex'
    )
  );
}

function normalizeRequest({
  instanceUuid,
  enrollmentToken,
  csrPem,
}) {
  const uuid =
    typeof instanceUuid === 'string'
      ? instanceUuid
          .trim()
          .toLowerCase()
      : '';

  if (!UUID_RE.test(uuid)) {
    throw enrollmentError(
      'Requete enrollment invalide.',
      400
    );
  }

  const token =
    typeof enrollmentToken === 'string'
      ? enrollmentToken.trim()
      : '';

  if (!TOKEN_RE.test(token)) {
    throw enrollmentError(
      'Requete enrollment invalide.',
      400
    );
  }

  const normalizedCsr =
    typeof csrPem === 'string'
      ? csrPem.trim()
      : '';

  if (
    !normalizedCsr.startsWith(
      '-----BEGIN CERTIFICATE REQUEST-----'
    ) ||
    !normalizedCsr.endsWith(
      '-----END CERTIFICATE REQUEST-----'
    ) ||
    Buffer.byteLength(
      normalizedCsr,
      'utf8'
    ) > MAX_CSR_BYTES
  ) {
    throw enrollmentError(
      'Requete enrollment invalide.',
      400
    );
  }

  return {
    uuid,
    token,
    csrPem: `${normalizedCsr}\n`,
  };
}

async function readClientCaPem() {
  const filePath =
    config.workerPki.clientCaCertPath;

  if (!filePath) {
    throw enrollmentError(
      'PKI backend non configuree.',
      500
    );
  }

  return fs.promises.readFile(
    filePath,
    'utf8'
  );
}

async function removeEnrollmentMetadata(
  instanceUuid
) {
  try {
    await openstackService
      .deleteServerMetadataKey(
        instanceUuid,
        ENROLLMENT_METADATA_KEY
      );
  } catch (_) {
    // Best effort :
    // PostgreSQL reste l'autorite pour le jeton consomme.
  }
}

async function enrollWorker(input) {
  const {
    uuid,
    token,
    csrPem,
  } = normalizeRequest(input);

  const tokenHash =
    sha256Hex(token);

  const csrSha256 =
    sha256Hex(csrPem);

  let session =
    await sessionRepository
      .getSessionByInstanceId(
        uuid
      );

  if (
    !session ||
    session.destroyed_at ||
    session.status !==
      'provisioning'
  ) {
    throw enrollmentError(
      'Enrollment worker refuse.',
      403
    );
  }

  if (
    !constantTimeHexEqual(
      tokenHash,
      session.worker_enrollment_token_hash
    )
  ) {
    throw enrollmentError(
      'Enrollment worker refuse.',
      403
    );
  }

  /*
   * Retry idempotent :
   * si le premier HTTP 200 a ete perdu,
   * le meme token + meme CSR recoit
   * exactement le certificat deja stocke.
   */
  if (
    session.worker_enrollment_consumed_at
  ) {
    if (
      constantTimeHexEqual(
        csrSha256,
        session.worker_enrollment_csr_sha256
      ) &&
      typeof session.worker_certificate_pem ===
        'string' &&
      session.worker_certificate_pem.trim()
    ) {
      return {
        serverCertPem:
          session.worker_certificate_pem,
        clientCaPem:
          await readClientCaPem(),
        replay: true,
      };
    }

    throw enrollmentError(
      'Enrollment worker deja consomme.',
      409
    );
  }

  const enrollmentExpiresAt =
    new Date(
      session.worker_enrollment_expires_at
    );

  if (
    !Number.isFinite(
      enrollmentExpiresAt.getTime()
    ) ||
    enrollmentExpiresAt.getTime() <=
      Date.now()
  ) {
    throw enrollmentError(
      'Enrollment worker expire.',
      403
    );
  }

  const expectedPublicIp =
    typeof session.elastic_ip ===
      'string'
      ? session.elastic_ip.trim()
      : '';

  if (!expectedPublicIp) {
    throw enrollmentError(
      'Infrastructure worker incomplete.',
      409
    );
  }

  try {
    await openstackService
      .validateWorkerInstance({
        instanceId: uuid,
        expectedPublicIp,
      });
  } catch (_) {
    throw enrollmentError(
      'Validation infrastructure worker impossible.',
      503
    );
  }

  let signed;

  try {
    signed =
      await signWorkerCsr({
        instanceUuid: uuid,
        expectedPublicIp,
        csrPem,
      });
  } catch (_) {
    throw enrollmentError(
      'CSR worker refuse.',
      400
    );
  }

  if (
    !constantTimeHexEqual(
      csrSha256,
      signed.csrSha256
    )
  ) {
    throw enrollmentError(
      'Empreinte CSR incoherente.',
      500
    );
  }

  const consumed =
    await sessionRepository
      .consumeWorkerEnrollment(
        session.id,
        tokenHash,
        signed.csrSha256,
        signed.serverCertPem
      );

  if (consumed) {
    await removeEnrollmentMetadata(
      uuid
    );

    return {
      serverCertPem:
        signed.serverCertPem,
      clientCaPem:
        signed.clientCaPem,
      replay: false,
    };
  }

  /*
   * Une requete concurrente avec le meme
   * token peut avoir gagne la course.
   * On ne renvoie le certificat que si
   * le CSR est exactement identique.
   */
  session =
    await sessionRepository
      .getSessionByInstanceId(
        uuid
      );

  if (
    session &&
    !session.destroyed_at &&
    constantTimeHexEqual(
      tokenHash,
      session.worker_enrollment_token_hash
    ) &&
    session.worker_enrollment_consumed_at &&
    constantTimeHexEqual(
      csrSha256,
      session.worker_enrollment_csr_sha256
    ) &&
    typeof session.worker_certificate_pem ===
      'string' &&
    session.worker_certificate_pem.trim()
  ) {
    await removeEnrollmentMetadata(
      uuid
    );

    return {
      serverCertPem:
        session.worker_certificate_pem,
      clientCaPem:
        signed.clientCaPem,
      replay: true,
    };
  }

  throw enrollmentError(
    'Enrollment worker deja consomme.',
    409
  );
}

module.exports = {
  enrollWorker,
};