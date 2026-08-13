const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({
  path: path.join(__dirname, '..', '..', '..', '.env'),
  quiet: true,
});

function parseInteger(value, fallback) {
  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue)) {
    return fallback;
  }

  return parsedValue;
}

function parseBoundedInteger(
  value,
  name,
  minimum,
  maximum,
  fallback
) {
  const parsed =
    value === undefined || value === ''
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} doit être un entier entre ${minimum} et ${maximum}.`
    );
  }

  return parsed;
}

function readEnv(primaryName, legacyName, fallback = '') {
  const primaryValue = process.env[primaryName];

  if (
    primaryValue !== undefined &&
    primaryValue !== ''
  ) {
    return primaryValue.trim();
  }

  if (legacyName) {
    const legacyValue = process.env[legacyName];

    if (
      legacyValue !== undefined &&
      legacyValue !== ''
    ) {
      return legacyValue.trim();
    }
  }

  return fallback;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function loadMfaEncryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      'MFA_ENCRYPTION_KEY est obligatoire et doit être un base64 de 32 octets.'
    );
  }

  let key;

  try {
    key = Buffer.from(raw, 'base64');
  } catch (_) {
    throw new Error(
      'MFA_ENCRYPTION_KEY doit être un base64 valide.'
    );
  }

  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) ||
    key.length !== 32
  ) {
    throw new Error(
      'MFA_ENCRYPTION_KEY doit être un base64 produisant exactement 32 octets.'
    );
  }

  return key;
}

function resolveTerraformBinary() {
  const configuredBinary = (
    process.env.TERRAFORM_BIN || ''
  ).trim();

  if (configuredBinary) {
    return configuredBinary;
  }

  const candidates = [
    'terraform',
    'terraform.exe',
  ];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(
        candidate,
        ['version'],
        {
          shell: false,
          stdio: 'ignore',
        }
      );

      if (result.status === 0) {
        return candidate;
      }
    } catch (_) {
      // Le candidat suivant sera testé.
    }
  }

  return null;
}

const port = parseBoundedInteger(
  process.env.PORT,
  'PORT',
  1,
  65535,
  3001
);

const proxyPort = parseInteger(
  process.env.SESSION_PROXY_PORT,
  port + 1
);

const terraformDirectory = path.resolve(
  __dirname,
  '..',
  '..',
  'terraform'
);

const adminToken = readEnv(
  'PRIVALYSE_ADMIN_TOKEN',
  'TERMINIATOR_ADMIN_TOKEN'
);

const allowedOrigins = new Set(
  readEnv(
    'PRIVALYSE_ALLOWED_ORIGINS',
    'TERMINIATOR_ALLOWED_ORIGINS',
    `http://localhost:${port},http://127.0.0.1:${port}`
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const publicBaseUrl = normalizeBaseUrl(
  readEnv(
    'PRIVALYSE_PUBLIC_URL',
    null,
    `http://localhost:${port}`
  )
);

const proxyBaseUrl = normalizeBaseUrl(
  readEnv(
    'PRIVALYSE_PROXY_URL',
    null,
    `http://localhost:${proxyPort}`
  )
);

const config = {
  environment:
    process.env.NODE_ENV || 'development',

  port,

  proxyPort,

  publicBaseUrl,

  proxyBaseUrl,

  terraform: {
    binary: resolveTerraformBinary(),
    directory: terraformDirectory,
  },

  stateFile: path.join(
    terraformDirectory,
    '.terminiator-state.json'
  ),

  admin: {
    token: adminToken,
    tokenEnabled: adminToken !== '',
  },

  cors: {
    allowedOrigins,
  },

  auth: {
    cookieName: (
      process.env.AUTH_COOKIE_NAME ||
      'terminiator_session'
    ).trim(),

    sessionDurationHours: parseInteger(
      process.env.AUTH_SESSION_HOURS,
      8
    ),

    secureCookies:
      process.env.NODE_ENV === 'production',
  },

  mfa: {
    encryptionKey: loadMfaEncryptionKey(),

    issuer: (
      process.env.MFA_ISSUER ||
      'Privalyse'
    ).trim(),

    challengeTtlSeconds: parseBoundedInteger(
      process.env.MFA_CHALLENGE_TTL_SECONDS,
      'MFA_CHALLENGE_TTL_SECONDS',
      60,
      900,
      300
    ),

    maxAttempts: parseBoundedInteger(
      process.env.MFA_MAX_ATTEMPTS,
      'MFA_MAX_ATTEMPTS',
      1,
      10,
      5
    ),
  },

  database: {
    url: (
      process.env.DATABASE_URL || ''
    ).trim(),

    ssl:
      (
        process.env.DATABASE_SSL || 'false'
      ).toLowerCase() === 'true',
  },

  openstack: {
    authType: (
      process.env.OS_AUTH_TYPE ||
      'v3applicationcredential'
    ).trim(),

    authUrl: (
      process.env.OS_AUTH_URL ||
      'https://api.pub1.infomaniak.cloud/identity/v3'
    ).trim(),

    applicationCredentialId: (
      process.env.OS_APPLICATION_CREDENTIAL_ID ||
      ''
    ).trim(),

    applicationCredentialSecret: (
      process.env.OS_APPLICATION_CREDENTIAL_SECRET ||
      ''
    ).trim(),

    identityApiVersion: (
      process.env.OS_IDENTITY_API_VERSION ||
      '3'
    ).trim(),

    interface: (
      process.env.OS_INTERFACE ||
      'public'
    ).trim(),

    region: (
      process.env.OS_REGION_NAME ||
      'dc4-a'
    ).trim(),
  },

  workspace: {
    // Profil CPU unique pour le MVP.
    instanceType: (
      process.env.PRIVALYSE_CPU_FLAVOR ||
      'a4-ram8-disk0'
    ).trim(),

    // Choix logique envoyé à Terraform.
    aiChoice: (
      process.env.PRIVALYSE_AI_CHOICE ||
      'qwen-mini'
    ).trim(),

    // Modèle Ollama CPU réel.
    ollamaModel: (
      process.env.PRIVALYSE_OLLAMA_MODEL ||
      'qwen2.5:0.5b'
    ).trim(),

    imageName: (
      process.env.PRIVALYSE_IMAGE_NAME ||
      'Ubuntu 24.04 LTS Noble Numbat'
    ).trim(),

    networkName: (
      process.env.PRIVALYSE_NETWORK_NAME ||
      'ext-net1'
    ).trim(),

    rootVolumeSizeGb: parseBoundedInteger(
      process.env.PRIVALYSE_ROOT_VOLUME_GB,
      'PRIVALYSE_ROOT_VOLUME_GB',
      30,
      500,
      40
    ),

    allowedCidr: (
      process.env.TF_VAR_allowed_cidr ||
      ''
    ).trim(),

    owuiEmail: readEnv(
      'PRIVALYSE_OWUI_EMAIL',
      'TERMINIATOR_OWUI_EMAIL',
      'admin@privalyse.local'
    ),
  },
};

module.exports = config;
