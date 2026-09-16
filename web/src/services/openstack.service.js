const net = require('net');

const config = require('../config/env');

const REQUEST_TIMEOUT_MS = 10000;

function assertOpenStackConfig() {
  if (
    !config.openstack.applicationCredentialId ||
    !config.openstack.applicationCredentialSecret
  ) {
    throw new Error(
      'Credentials OpenStack Application Credential manquants.'
    );
  }

  if (!config.openstack.authUrl) {
    throw new Error(
      'OS_AUTH_URL manquant.'
    );
  }

  if (!config.openstack.region) {
    throw new Error(
      'OS_REGION_NAME manquant.'
    );
  }
}

async function requestJson(
  url,
  options = {},
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(
      url,
      {
        ...options,
        signal: controller.signal,
      }
    );

    const text = await response.text();

    let body = {};

    if (text) {
      try {
        body = JSON.parse(text);
      } catch (_) {
        body = {};
      }
    }

    if (!response.ok) {
      const error = new Error(
        `OpenStack HTTP ${response.status}.`
      );

      error.statusCode = response.status;
      throw error;
    }

    return {
      response,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function authenticate() {
  assertOpenStackConfig();

  const authUrl =
    config.openstack.authUrl
      .replace(/\/+$/, '');

  const {
    response,
    body,
  } = await requestJson(
    `${authUrl}/auth/tokens`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        auth: {
          identity: {
            methods: [
              'application_credential',
            ],
            application_credential: {
              id:
                config.openstack
                  .applicationCredentialId,
              secret:
                config.openstack
                  .applicationCredentialSecret,
            },
          },
        },
      }),
    }
  );

  const token =
    response.headers.get(
      'x-subject-token'
    );

  if (!token) {
    throw new Error(
      'Token OpenStack absent.'
    );
  }

  const services =
    Array.isArray(body.token?.catalog)
      ? body.token.catalog
      : [];

  const computeService =
    services.find(
      (service) =>
        service.type === 'compute'
    );

  if (!computeService) {
    throw new Error(
      'Service Compute OpenStack introuvable.'
    );
  }

  const endpoints =
    Array.isArray(computeService.endpoints)
      ? computeService.endpoints
      : [];

  const computeEndpoint =
    endpoints.find(
      (endpoint) =>
        endpoint.interface ===
          config.openstack.interface &&
        endpoint.region ===
          config.openstack.region
    );

  if (!computeEndpoint?.url) {
    throw new Error(
      `Endpoint Compute OpenStack introuvable pour ${config.openstack.region}.`
    );
  }

  return {
    token,
    computeUrl:
      computeEndpoint.url
        .replace(/\/+$/, ''),
  };
}

function collectServerIpv4(server) {
  const addresses = new Set();

  if (
    typeof server?.accessIPv4 === 'string' &&
    net.isIP(server.accessIPv4) === 4
  ) {
    addresses.add(server.accessIPv4);
  }

  const networks =
    server?.addresses &&
    typeof server.addresses === 'object'
      ? Object.values(server.addresses)
      : [];

  for (const networkAddresses of networks) {
    if (!Array.isArray(networkAddresses)) {
      continue;
    }

    for (const entry of networkAddresses) {
      const address =
        typeof entry?.addr === 'string'
          ? entry.addr.trim()
          : '';

      if (net.isIP(address) === 4) {
        addresses.add(address);
      }
    }
  }

  return Array.from(addresses);
}

async function getServerById(instanceId) {
  const normalizedInstanceId =
    typeof instanceId === 'string'
      ? instanceId.trim()
      : '';

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(normalizedInstanceId)
  ) {
    throw new Error(
      'UUID OpenStack invalide.'
    );
  }

  const {
    token,
    computeUrl,
  } = await authenticate();

  const {
    body,
  } = await requestJson(
    `${computeUrl}/servers/${encodeURIComponent(normalizedInstanceId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Auth-Token': token,
      },
    }
  );

  if (!body.server) {
    throw new Error(
      'Instance OpenStack absente de la reponse Compute.'
    );
  }

  return body.server;
}

async function validateWorkerInstance({
  instanceId,
  expectedPublicIp,
}) {
  const normalizedExpectedIp =
    typeof expectedPublicIp === 'string'
      ? expectedPublicIp.trim()
      : '';

  if (
    net.isIP(normalizedExpectedIp) !== 4
  ) {
    throw new Error(
      'IP publique attendue invalide.'
    );
  }

  const server =
    await getServerById(instanceId);

  if (
    String(server.id).toLowerCase() !==
    String(instanceId).toLowerCase()
  ) {
    throw new Error(
      'UUID OpenStack incoherent.'
    );
  }

  const status =
    String(server.status || '')
      .toUpperCase();

  if (
    status !== 'ACTIVE' &&
    status !== 'BUILD'
  ) {
    throw new Error(
      `Etat OpenStack non autorise pour enrollment: ${status || 'UNKNOWN'}.`
    );
  }

  const ipv4 =
    collectServerIpv4(server);

  if (
    !ipv4.includes(
      normalizedExpectedIp
    )
  ) {
    throw new Error(
      'IP de la VM differente de celle enregistree pour la session.'
    );
  }

  return {
    id: server.id,
    name: server.name || null,
    status,
    ipv4,
  };
}

async function setServerMetadata(
  instanceId,
  metadata
) {
  const normalizedInstanceId =
    typeof instanceId === 'string'
      ? instanceId.trim()
      : '';

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(normalizedInstanceId)
  ) {
    throw new Error(
      'UUID OpenStack invalide.'
    );
  }

  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    throw new Error(
      'Metadata OpenStack invalide.'
    );
  }

  const sanitizedMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
      throw new Error(
        'Cle metadata OpenStack invalide.'
      );
    }

    const normalizedValue =
      String(value ?? '');

    if (
      normalizedValue.length < 1 ||
      normalizedValue.length > 255
    ) {
      throw new Error(
        'Valeur metadata OpenStack invalide.'
      );
    }

    sanitizedMetadata[key] =
      normalizedValue;
  }

  const {
    token,
    computeUrl,
  } = await authenticate();

  const {
    body,
  } = await requestJson(
    `${computeUrl}/servers/${encodeURIComponent(normalizedInstanceId)}/metadata`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
      },
      body: JSON.stringify({
        metadata: sanitizedMetadata,
      }),
    }
  );

  return body.metadata || {};
}

async function deleteServerMetadataKey(
  instanceId,
  key
) {
  const normalizedInstanceId =
    typeof instanceId === 'string'
      ? instanceId.trim()
      : '';

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(normalizedInstanceId)
  ) {
    throw new Error(
      'UUID OpenStack invalide.'
    );
  }

  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
    throw new Error(
      'Cle metadata OpenStack invalide.'
    );
  }

  const {
    token,
    computeUrl,
  } = await authenticate();

  await requestJson(
    `${computeUrl}/servers/${encodeURIComponent(normalizedInstanceId)}/metadata/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'X-Auth-Token': token,
      },
    }
  );
}
module.exports = {
  authenticate,
  getServerById,
  validateWorkerInstance,
  setServerMetadata,
  deleteServerMetadataKey,
};