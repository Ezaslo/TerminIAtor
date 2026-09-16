const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const config = require('../config/env');

const execFileAsync = promisify(execFile);

const MAX_CSR_BYTES = 16 * 1024;
const OPENSSL_TIMEOUT_MS = 10_000;
const OPENSSL_MAX_BUFFER = 256 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeInstanceUuid(instanceUuid) {
  const normalized =
    typeof instanceUuid === 'string'
      ? instanceUuid.trim().toLowerCase()
      : '';

  if (!UUID_RE.test(normalized)) {
    throw new Error(
      'UUID worker invalide.'
    );
  }

  return normalized;
}

function normalizeCsrPem(csrPem) {
  const normalized =
    typeof csrPem === 'string'
      ? csrPem.trim()
      : '';

  if (
    !normalized.startsWith(
      '-----BEGIN CERTIFICATE REQUEST-----'
    ) ||
    !normalized.endsWith(
      '-----END CERTIFICATE REQUEST-----'
    ) ||
    Buffer.byteLength(
      normalized,
      'utf8'
    ) > MAX_CSR_BYTES
  ) {
    throw new Error(
      'CSR worker invalide.'
    );
  }

  return `${normalized}\n`;
}

function assertWorkerPkiConfig() {
  const requiredFiles = [
    [
      'CA serveur worker',
      config.workerPki.serverCaCertPath,
    ],
    [
      'cle CA serveur worker',
      config.workerPki.serverCaKeyPath,
    ],
    [
      'CA client backend',
      config.workerPki.clientCaCertPath,
    ],
  ];

  if (!config.workerPki.opensslBinary) {
    throw new Error(
      'Binaire OpenSSL non configure.'
    );
  }

  for (
    const [label, filePath]
    of requiredFiles
  ) {
    if (
      !filePath ||
      !fs.existsSync(filePath)
    ) {
      throw new Error(
        `${label} introuvable.`
      );
    }
  }
}

async function runOpenSsl(args) {
  try {
    return await execFileAsync(
      config.workerPki.opensslBinary,
      args,
      {
        encoding: 'utf8',
        timeout: OPENSSL_TIMEOUT_MS,
        maxBuffer: OPENSSL_MAX_BUFFER,
        windowsHide: true,
        shell: false,
      }
    );
  } catch (error) {
    const detail =
      String(
        error?.stderr ||
        error?.stdout ||
        error?.message ||
        'erreur inconnue'
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);

    throw new Error(
      `Echec OpenSSL: ${detail}`
    );
  }
}

function normalizeSubject(rawSubject) {
  return String(rawSubject || '')
    .trim()
    .replace(
      /^subject\s*=\s*/i,
      ''
    )
    .replace(
      /\s*=\s*/g,
      '='
    );
}

async function signWorkerCsr({
  instanceUuid,
  expectedPublicIp,
  csrPem,
}) {
  assertWorkerPkiConfig();

  const uuid =
    normalizeInstanceUuid(
      instanceUuid
    );

  const ip =
    typeof expectedPublicIp === 'string'
      ? expectedPublicIp.trim()
      : '';

  if (net.isIP(ip) !== 4) {
    throw new Error(
      'IP publique worker invalide.'
    );
  }

  const normalizedCsrPem =
    normalizeCsrPem(csrPem);

  const expectedSubject =
    `CN=privalyse-worker-${uuid}`;

  const csrSha256 =
    crypto
      .createHash('sha256')
      .update(
        normalizedCsrPem,
        'utf8'
      )
      .digest('hex');

  const temporaryDirectory =
    await fs.promises.mkdtemp(
      path.join(
        os.tmpdir(),
        'privalyse-worker-pki-'
      )
    );

  const csrPath =
    path.join(
      temporaryDirectory,
      'worker.csr'
    );

  const extensionPath =
    path.join(
      temporaryDirectory,
      'worker.ext'
    );

  const certificatePath =
    path.join(
      temporaryDirectory,
      'worker.crt'
    );

  try {
    await fs.promises.writeFile(
      csrPath,
      normalizedCsrPem,
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      }
    );

    // Vérifie notamment la signature cryptographique
    // du CSR avant toute émission de certificat.
    await runOpenSsl([
      'req',
      '-in',
      csrPath,
      '-noout',
      '-verify',
    ]);

    const subjectResult =
      await runOpenSsl([
        'req',
        '-in',
        csrPath,
        '-noout',
        '-subject',
        '-nameopt',
        'RFC2253',
      ]);

    const actualSubject =
      normalizeSubject(
        subjectResult.stdout
      );

    if (
      actualSubject !==
      expectedSubject
    ) {
      throw new Error(
        'Identite CSR worker incoherente.'
      );
    }

    const publicKeyResult =
      await runOpenSsl([
        'req',
        '-in',
        csrPath,
        '-pubkey',
        '-noout',
      ]);

    const csrPublicKey =
      crypto.createPublicKey(
        publicKeyResult.stdout
      );

    const csrPublicKeyDer =
      csrPublicKey.export({
        type: 'spki',
        format: 'der',
      });

    const extensionContent = [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=IP:${ip}`,
      '',
    ].join('\n');

    await fs.promises.writeFile(
      extensionPath,
      extensionContent,
      {
        encoding: 'ascii',
        mode: 0o600,
        flag: 'wx',
      }
    );

    // Numéro de série aléatoire : pas de fichier .srl
    // partagé et donc pas de course entre enrollments.
    const serial =
      crypto
        .randomBytes(16)
        .toString('hex');

    await runOpenSsl([
      'x509',
      '-req',
      '-in',
      csrPath,
      '-CA',
      config.workerPki.serverCaCertPath,
      '-CAkey',
      config.workerPki.serverCaKeyPath,
      '-set_serial',
      `0x${serial}`,
      '-days',
      '1',
      '-sha256',
      '-extfile',
      extensionPath,
      '-out',
      certificatePath,
    ]);

    await runOpenSsl([
      'verify',
      '-CAfile',
      config.workerPki.serverCaCertPath,
      certificatePath,
    ]);

    const serverCertPem =
      await fs.promises.readFile(
        certificatePath,
        'utf8'
      );

    const certificate =
      new crypto.X509Certificate(
        serverCertPem
      );

    if (
      certificate.subject !==
      expectedSubject
    ) {
      throw new Error(
        'Sujet certificat worker incoherent.'
      );
    }

    if (
      !certificate.checkIP(ip)
    ) {
      throw new Error(
        'SAN IP certificat worker incoherent.'
      );
    }

    const certificatePublicKeyDer =
      certificate.publicKey.export({
        type: 'spki',
        format: 'der',
      });

    if (
      !Buffer.from(
        csrPublicKeyDer
      ).equals(
        Buffer.from(
          certificatePublicKeyDer
        )
      )
    ) {
      throw new Error(
        'Cle publique certificat differente du CSR.'
      );
    }

    const clientCaPem =
      await fs.promises.readFile(
        config.workerPki.clientCaCertPath,
        'utf8'
      );

    return {
      serverCertPem,
      clientCaPem,
      csrSha256,
    };
  } finally {
    await fs.promises.rm(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

module.exports = {
  signWorkerCsr,
};