const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');


const config = require('./src/config/env');

const terraformService = require(
  './src/services/terraform.service'
);
const awsService = require(
  './src/services/aws.service'
);
const authRoutes = require(
  './src/routes/auth.routes'
);
const adminRoutes = require(
  './src/routes/admin.routes'
);
const authMiddleware = require(
  './src/middleware/auth.middleware'
);
const app = express();
const proxyApp = express();

const PORT = config.port;
const PROXY_PORT = config.proxyPort;

const TERRAFORM_DIR =
  config.terraform.directory;

const STATE_FILE =
  config.stateFile;

const ADMIN_TOKEN =
  config.admin.token;

const ADMIN_TOKEN_ENABLED =
  config.admin.tokenEnabled;

const ALLOWED_ORIGINS =
  config.cors.allowedOrigins;

const TERRAFORM_BIN =
  config.terraform.binary;
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origine non autorisee par CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json({ limit: '32kb' }));

app.use(
  '/api/auth',
  authRoutes
);
app.use(
  '/api/admin',
  adminRoutes
);
app.use(express.static('public'));

const clients = [];

const currentOperation = {
  type: 'idle',
  status: 'idle',
  phase: 'idle',
  cancelReadiness: false,
  logs: []
};

const sessionState = {
  active: false,
  status: 'idle',
  workspaceName: null,
  workspaceSlug: null,
  accessUrl: null,
  instanceType: null,
  modelLabel: null,
  adminEmail: null,
  accessNotes: null,
  authMode: null,
  teamSizeHint: null,
  sessionTtlHours: null,
  createdAt: null,
  expiresAt: null
};

const draftSessionState = {
  active: false,
  status: 'idle',
  workspaceName: null,
  workspaceSlug: null,
  accessUrl: null,
  instanceType: null,
  modelLabel: null,
  adminEmail: null,
  accessNotes: null,
  authMode: null,
  teamSizeHint: null,
  sessionTtlHours: null,
  createdAt: null,
  expiresAt: null
};

const sessionSecrets = {
  adminEmail: null,
  adminPassword: null,
  jwt: null,
  jwtExpiresAt: null,
  launchToken: null,
  launchTokenExpiresAt: null
};

let ttlDestroyTimer = null;
const PROXY_COOKIE_NAME = 'terminiator_launch_token';

const AI_PULL_MAP = {
  'qwen-mini': 'qwen2.5:0.5b',
  'llama3-1b': 'llama3.2:1b',
  'phi3-mini': 'phi3:mini',
  'phi4-mini': 'phi4-mini',
  'qwen-7b': 'qwen2.5:7b',
  'qwen-14b': 'qwen2.5:14b',
  'qwen-coder-14b': 'qwen2.5-coder:14b',
  'gpt-oss': 'gpt-oss:20b',
  'gpt-oss-20b': 'gpt-oss:20b',
  'mistral-small-24b': 'mistral-small3.2:24b',
  'dolphin3-8b': 'dolphin3:8b',
  'llama2-uncensored-7b': 'llama2-uncensored:7b'
};

const AUTH_MODES = new Set(['local_admin', 'trusted_header']);

const INSTANCE_TYPES = new Set([
  't3.small',
  't3.medium',
  't3.large',
  't3.xlarge',
  't3.2xlarge',
  'g4dn.xlarge',
  'g4dn.2xlarge',
  'g4dn.4xlarge',
  'g4dn.8xlarge'
]);

const INFRA_DESTROY_TARGETS = [
  'aws_instance.ai_host',
  'aws_security_group.ec2_min',
  'aws_iam_role_policy.tag_self',
  'aws_iam_instance_profile.ssm_profile',
  'aws_iam_role_policy_attachment.ssm_core',
  'aws_iam_role_policy_attachment.cw_agent',
  'aws_iam_role.ssm_role',
  'aws_route_table_association.public_a',
  'aws_route.public_internet_access',
  'aws_route_table.public',
  'aws_internet_gateway.igw',
  'aws_subnet.public_a',
  'aws_vpc.main'
];

function requireAdminToken(req, res, next) {
  if (!ADMIN_TOKEN_ENABLED) {
    next();
    return;
  }

  const provided = req.get('X-Terminiator-Admin-Token') || '';
  if (provided === ADMIN_TOKEN) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: 'Token administrateur TerminIAtor invalide ou manquant'
  });
}

function isValidIPv4Cidr(cidr) {
  if (typeof cidr !== 'string') return false;
  const match = cidr.trim().match(/^(\d{1,3})(?:\.(\d{1,3})){3}\/(\d{1,2})$/);
  if (!match) return false;

  const [ip, prefix] = cidr.trim().split('/');
  const octets = ip.split('.').map((part) => Number.parseInt(part, 10));
  const prefixNumber = Number.parseInt(prefix, 10);

  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    Number.isInteger(prefixNumber) &&
    prefixNumber >= 0 &&
    prefixNumber <= 32 &&
    cidr.trim() !== '0.0.0.0/0'
  );
}

function assertPlainTextField(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} invalide`);
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\r\n]/.test(trimmed)) {
    throw new Error(`${fieldName} invalide`);
  }

  return trimmed;
}

function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return 'non renseigne';
  const [name, domain] = email.split('@');
  const visible = name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`;
}

function clearSessionLikeState(target) {
  target.active = false;
  target.status = 'idle';
  target.workspaceName = null;
  target.workspaceSlug = null;
  target.accessUrl = null;
  target.instanceType = null;
  target.modelLabel = null;
  target.adminEmail = null;
  target.accessNotes = null;
  target.authMode = null;
  target.teamSizeHint = null;
  target.sessionTtlHours = null;
  target.createdAt = null;
  target.expiresAt = null;
}

function clearSessionSecrets() {
  sessionSecrets.adminEmail = null;
  sessionSecrets.adminPassword = null;
  sessionSecrets.jwt = null;
  sessionSecrets.jwtExpiresAt = null;
  sessionSecrets.launchToken = null;
  sessionSecrets.launchTokenExpiresAt = null;
}

function buildAccessNotes(authMode, workspaceUrl, adminEmail) {
  if (authMode === 'trusted_header') {
    return workspaceUrl
      ? 'Partage uniquement le lien d entreprise deja protege par le proxy ou le SSO.'
      : 'Configure un proxy ou un SSO d entreprise avant de partager la session.';
  }

  return `Connecte-toi avec le compte admin ${adminEmail}.`;
}

function hclString(value) {
  return JSON.stringify(value);
}

function slugifyWorkspaceName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'session-ia';
}

function isValidWorkspaceUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return true;

  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function assertHeaderName(value, fieldName) {
  const trimmed = assertPlainTextField(value, fieldName, 80);
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) {
    throw new Error(`${fieldName} invalide`);
  }
  return trimmed;
}

function pushLog(message, type = 'info') {
  const log = {
    message,
    type,
    timestamp: new Date().toISOString()
  };
  currentOperation.logs.push(log);

  const data = `data: ${JSON.stringify(log)}\n\n`;
  clients.forEach((res) => res.write(data));
}

function persistState() {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          sessionState,
          draftSessionState,
          sessionSecrets,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
  } catch (error) {
    pushLog(`Impossible de sauvegarder l'etat: ${error.message}`, 'error');
  }
}

function loadPersistedState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.sessionState && typeof parsed.sessionState === 'object') {
      Object.assign(sessionState, parsed.sessionState);
    }
    if (parsed && parsed.draftSessionState && typeof parsed.draftSessionState === 'object') {
      Object.assign(draftSessionState, parsed.draftSessionState);
    }
  if (parsed && parsed.sessionSecrets && typeof parsed.sessionSecrets === 'object') {
    Object.assign(sessionSecrets, parsed.sessionSecrets);
  }
  } catch (error) {
    pushLog(`Etat persiste ignore: ${error.message}`, 'error');
  }
}

function clearScheduledDestroy() {
  if (ttlDestroyTimer) {
    clearTimeout(ttlDestroyTimer);
    ttlDestroyTimer = null;
  }
}

async function destroySessionInternal(reason = 'manual') {
  return destroyInfraInternal(reason);
}

async function destroyInfraInternal(reason = 'manual') {
  currentOperation.type = 'destroy';
  currentOperation.status = 'running';
  currentOperation.phase = 'terraform';
  currentOperation.cancelReadiness = false;
  currentOperation.logs = [];
  pushLog(`Destruction complete demandee (${reason})`, 'info');

  let destroySucceeded = false;

  try {
    await runTerraform(
      [
        'destroy',
        '-auto-approve',
        ...INFRA_DESTROY_TARGETS.flatMap((target) => ['-target', target])
      ],
      {
        TF_VAR_allowed_cidr: process.env.TF_VAR_allowed_cidr || '127.0.0.1/32',
        TF_VAR_webui_secret_key:
          process.env.TF_VAR_webui_secret_key || crypto.randomBytes(48).toString('hex')
      }
    );
    destroySucceeded = true;
  } finally {
    clearScheduledDestroy();
    clearSessionLikeState(sessionState);
    clearSessionLikeState(draftSessionState);
    clearSessionSecrets();
    persistState();
    currentOperation.status = destroySucceeded ? 'success' : 'error';
    currentOperation.phase = 'idle';
    currentOperation.type = destroySucceeded ? 'idle' : currentOperation.type;
  }
}

function scheduleDestroyFromTtl(hours) {
  clearScheduledDestroy();

  const ttlMs = hours * 60 * 60 * 1000;
  ttlDestroyTimer = setTimeout(async () => {
    if (!sessionState.active || currentOperation.status === 'running') {
      return;
    }

    pushLog(
      `TTL atteint (${hours}h). Lancement de la destruction automatique de la session.`,
      'info'
    );

    try {
      await destroySessionInternal('ttl');
      pushLog('Destruction automatique terminee', 'success');
    } catch (error) {
      currentOperation.status = 'error';
      currentOperation.phase = 'idle';
      currentOperation.cancelReadiness = false;
      pushLog(`Erreur destruction automatique: ${error.message}`, 'error');
      persistState();
    }
  }, ttlMs);
}

function restorePersistedSession() {
  loadPersistedState();
  if (!sessionState.active || !sessionState.expiresAt) {
    return;
  }

  const expiresAtMs = new Date(sessionState.expiresAt).getTime();
  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs > 0) {
    clearScheduledDestroy();
    ttlDestroyTimer = setTimeout(async () => {
      if (!sessionState.active || currentOperation.status === 'running') {
        return;
      }

      pushLog(
        `TTL restaure atteint. Lancement de la destruction automatique de la session.`,
        'info'
      );

      try {
        await destroySessionInternal('ttl');
        pushLog('Destruction automatique terminee', 'success');
      } catch (error) {
        currentOperation.status = 'error';
        currentOperation.phase = 'idle';
        currentOperation.cancelReadiness = false;
        pushLog(`Erreur destruction automatique: ${error.message}`, 'error');
        persistState();
      }
    }, remainingMs);
    return;
  }

  clearSessionLikeState(sessionState);
  clearSessionLikeState(draftSessionState);
  clearSessionSecrets();
  persistState();
}

app.get(
  '/api/stream',

  authMiddleware.authenticate,

  authMiddleware.requireAuthentication,

  (req, res) => {
  if (ADMIN_TOKEN_ENABLED && (req.query.token || '') !== ADMIN_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: 'Token administrateur TerminIAtor invalide ou manquant'
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  currentOperation.logs.forEach((log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  clients.push(res);

  req.on('close', () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

app.get(
  '/api/session',

  authMiddleware.authenticate,

  authMiddleware.requireAuthentication,

  requireAdminToken,

  (req, res) => {
  res.json({
    ok: true,
    session: {
      ...sessionState,
      autoOpenAvailable:
        sessionState.active &&
        sessionState.status === 'ready' &&
        sessionState.authMode === 'local_admin',
      proxyUrl:
        sessionState.active &&
        sessionState.status === 'ready' &&
        sessionState.authMode === 'local_admin'
          ? getProxyBaseUrl(req)
          : null,
      now: new Date().toISOString()
    },
    draftSession: {
      ...draftSessionState,
      now: new Date().toISOString()
    },
    operation: {
      type: currentOperation.type,
      status: currentOperation.status,
      phase: currentOperation.phase
    }
  });
});

app.post(
  '/api/session/open',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  requireAdminToken,

  async (req, res) => {
  try {
    assertLocalAdminReady();
    await ensureOpenWebUiJwt();
    sessionSecrets.launchToken = crypto.randomBytes(24).toString('base64url');
    sessionSecrets.launchTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    persistState();

    return res.json({
      ok: true,
      openUrl: `${getProxyBaseUrl(req)}/launch/${sessionSecrets.launchToken}`
    });
  } catch (error) {
    return res.status(409).json({
      ok: false,
      error: error.message
    });
  }
});

app.get(
  '/api/public-cidr',

  authMiddleware.authenticate,

  authMiddleware.requireAuthentication,

  async (req, res) => {
  try {
    const data = await fetchJson('https://api.ipify.org?format=json');
    const ip = typeof data.ip === 'string' ? data.ip.trim() : '';
    if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
      return res.status(502).json({ ok: false, error: 'IP publique indisponible' });
    }

    res.json({ ok: true, cidr: `${ip}/32` });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: `Impossible de detecter l IP publique: ${error.message}`
    });
  }
});
 function runTerraform(
  argumentsList,
  extraEnvironment = {}
) {
  return terraformService.runTerraform(
    argumentsList,
    {
      cwd: TERRAFORM_DIR,
      extraEnvironment,
      onLog: pushLog,
    }
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOperationToLeaveRunning(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (currentOperation.status !== 'running') {
      return true;
    }
    await sleep(200);
  }

  return currentOperation.status !== 'running';
}

function checkHttpStatus(url, acceptedStatuses = [200]) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (acceptedStatuses.includes(res.statusCode)) {
        resolve();
      } else {
        reject(new Error(`Status ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function terraformOutputRaw(name) {
  return terraformService.outputRaw(
    name,
    {
      cwd: TERRAFORM_DIR,
    }
  );
}
function readEc2Tag(
  instanceId,
  key
) {
  return awsService.readEc2Tag(
    instanceId,
    key,
    {
      cwd: TERRAFORM_DIR,
    }
  );
}
function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      target,
      {
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const parsedBody = body ? JSON.parse(body) : {};
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: parsedBody
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    if (options.body) {
      req.write(options.body);
    }

    req.on('error', reject);
    req.setTimeout(options.timeoutMs || 5000, () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

async function fetchJson(url) {
  const response = await requestJson(url);
  return response.body;
}

function getOpenWebUiBaseUrl() {
  if (!sessionState.accessUrl) return null;
  try {
    const url = new URL(sessionState.accessUrl);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return null;
  }
}

function getProxyBaseUrl(req = null) {
  const host = req?.hostname || 'localhost';
  return `http://${host}:${PROXY_PORT}`;
}

function getCookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const cookie = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(name.length + 1));
}

function buildForwardCookieHeader(req) {
  const raw = req.headers.cookie || '';
  const filtered = raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith(`${PROXY_COOKIE_NAME}=`));

  return filtered.length ? filtered.join('; ') : undefined;
}

function normalizeSetCookieHeaders(setCookieHeaders = [], targetHost = 'localhost') {
  return setCookieHeaders
    .map((cookie) => String(cookie))
    .map((cookie) =>
      cookie
        .replace(/;\s*Domain=[^;]+/gi, '')
        .replace(/;\s*domain=[^;]+/gi, '')
        .replace(/;\s*Secure/gi, '')
        .replace(/;\s*samesite=None/gi, '; SameSite=Lax')
        .replace(/;\s*samesite=none/gi, '; SameSite=Lax')
        .replace(/;\s*SameSite=None/gi, '; SameSite=Lax')
        .replace(/;\s*SameSite=none/gi, '; SameSite=Lax')
    )
    .map((cookie) => {
      if (/;\s*Path=/i.test(cookie)) {
        return cookie;
      }
      return `${cookie}; Path=/`;
    });
}

function assertLocalAdminReady() {
  if (!sessionState.active || sessionState.status !== 'ready') {
    throw new Error('La session OpenWebUI n est pas encore prete');
  }
  if (sessionState.authMode !== 'local_admin') {
    throw new Error('L ouverture automatique n est disponible qu en mode compte admin local');
  }
}

async function signInToOpenWebUi() {
  const openWebUiBaseUrl = getOpenWebUiBaseUrl();
  if (!openWebUiBaseUrl) {
    throw new Error('URL OpenWebUI indisponible pour le login automatique');
  }
  if (!sessionSecrets.adminEmail || !sessionSecrets.adminPassword) {
    throw new Error('Identifiants OpenWebUI indisponibles pour le login automatique');
  }

  const response = await requestJson(`${openWebUiBaseUrl}/api/v1/auths/signin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: sessionSecrets.adminEmail,
      password: sessionSecrets.adminPassword
    }),
    timeoutMs: 15000
  });

  if (response.statusCode < 200 || response.statusCode >= 300 || !response.body?.token) {
    throw new Error('Connexion automatique OpenWebUI impossible');
  }

  sessionSecrets.jwt = response.body.token;
  sessionSecrets.jwtExpiresAt = response.body.expires_at
    ? new Date(response.body.expires_at * 1000).toISOString()
    : new Date(Date.now() + 60 * 60 * 1000).toISOString();
  persistState();
  return sessionSecrets.jwt;
}

async function ensureOpenWebUiJwt() {
  if (sessionSecrets.jwt && sessionSecrets.jwtExpiresAt) {
    const expiresMs = new Date(sessionSecrets.jwtExpiresAt).getTime();
    if (Number.isFinite(expiresMs) && expiresMs - Date.now() > 60 * 1000) {
      return sessionSecrets.jwt;
    }
  }

  return signInToOpenWebUi();
}

function rewriteProxyLocation(location, targetBaseUrl, req) {
  if (!location) return location;

  try {
    const targetBase = new URL(targetBaseUrl);
    const resolved = new URL(location, targetBase);
    if (resolved.origin !== targetBase.origin) {
      return location;
    }

    const proxyBase = new URL(getProxyBaseUrl(req));
    return `${proxyBase.origin}${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch (_) {
    return location;
  }
}

function proxyRequestToOpenWebUi(req, res, jwt) {
  const targetBaseUrl = getOpenWebUiBaseUrl();
  if (!targetBaseUrl) {
    res.status(503).send('Session OpenWebUI indisponible');
    return;
  }

  const targetUrl = new URL(req.originalUrl, targetBaseUrl);
  const client = targetUrl.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  headers.authorization = `Bearer ${jwt}`;
  headers['accept-encoding'] = 'identity';
  headers.connection = 'keep-alive';
  headers.host = targetUrl.host;
  headers.origin = targetBaseUrl;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = 'http';

  const forwardCookies = buildForwardCookieHeader(req);
  if (forwardCookies) {
    headers.cookie = forwardCookies;
  } else {
    delete headers.cookie;
  }

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method,
      headers
    },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders['content-encoding'];
      delete responseHeaders['content-length'];
      if (responseHeaders.location) {
        responseHeaders.location = rewriteProxyLocation(responseHeaders.location, targetBaseUrl, req);
      }
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    res.status(502).send(`Proxy OpenWebUI indisponible: ${error.message}`);
  });

  req.pipe(proxyReq);
}

function proxyUpgradeToOpenWebUi(req, socket, head) {
  try {
    assertLocalAdminReady();
  } catch (_) {
    socket.destroy();
    return;
  }

  const cookieToken = getCookieValue(req, PROXY_COOKIE_NAME);
  if (
    !cookieToken ||
    !sessionSecrets.launchToken ||
    cookieToken !== sessionSecrets.launchToken ||
    !sessionSecrets.jwt
  ) {
    socket.destroy();
    return;
  }

  const targetBaseUrl = getOpenWebUiBaseUrl();
  if (!targetBaseUrl) {
    socket.destroy();
    return;
  }

  const targetUrl = new URL(req.url, targetBaseUrl);
  const client = targetUrl.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  headers.origin = targetBaseUrl;
  headers.authorization = `Bearer ${sessionSecrets.jwt}`;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = 'http';

  const proxyReq = client.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: `${targetUrl.pathname}${targetUrl.search}`,
    method: req.method,
    headers
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/${req.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n` +
        Object.entries(proxyRes.headers)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('; ') : value}`)
          .join('\r\n') +
        '\r\n\r\n'
    );
    if (proxyHead && proxyHead.length) {
      socket.write(proxyHead);
    }
    if (head && head.length) {
      proxySocket.write(head);
    }
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => {
    socket.destroy();
  });

  proxyReq.end();
}

function getReadinessBudget(instanceType) {
  const isGpuInstance = /^(g|p)\d/i.test(instanceType || '');

  if (isGpuInstance) {
    // GPU: le premier chargement peut prendre plusieurs minutes.
    return { maxAttempts: 120, delayMs: 5000 }; // 10 min
  }

  // CPU: initialisation et inference initiale beaucoup plus longues.
  return { maxAttempts: 360, delayMs: 5000 }; // 30 min
}

async function waitForIaReady(ip, instanceType, expectedModel = null, instanceId = null) {
  const openWebUiUrl = `http://${ip}:3000/`;

  const { maxAttempts, delayMs } = getReadinessBudget(instanceType);
  const totalMinutes = Math.round((maxAttempts * delayMs) / 60000);

  pushLog(
    `Test OpenWebUI et cloud-init sur ${openWebUiUrl} (fenetre d'attente: ~${totalMinutes} min, instance=${instanceType}, modele=${expectedModel || 'n/a'})`,
    'info'
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (currentOperation.cancelReadiness) {
      pushLog('Attente readiness interrompue a la demande utilisateur', 'info');
      return { ready: false, cancelled: true };
    }

    try {
      await checkHttpStatus(openWebUiUrl, [200, 301, 302, 307, 308]);
      if (instanceId) {
        const readyTag = readEc2Tag(instanceId, 'AI');
        if (readyTag !== 'ready') {
          pushLog(`OpenWebUI repond, cloud-init encore en cours (tentative ${attempt}/${maxAttempts})`, 'info');
          throw new Error('cloud-init-not-ready');
        }
      }

      pushLog(`OpenWebUI et cloud-init prets sur ${openWebUiUrl}`, 'ia-ready');
      return { ready: true, url: openWebUiUrl, cancelled: false };
    } catch (e) {
      if (e.message !== 'cloud-init-not-ready') {
        pushLog(`IA pas encore prete (tentative ${attempt}/${maxAttempts})`, 'info');
      }

      const sliceMs = 500;
      for (let waited = 0; waited < delayMs; waited += sliceMs) {
        if (currentOperation.cancelReadiness) {
          pushLog('Attente readiness interrompue a la demande utilisateur', 'info');
          return { ready: false, cancelled: true };
        }
        await sleep(Math.min(sliceMs, delayMs - waited));
      }
    }
  }

  pushLog(`IA toujours pas prete apres ${maxAttempts} tentatives`, 'error');
  return { ready: false, cancelled: false };
}

app.post(
  '/api/deploy',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  requireAdminToken,

  async (req, res) => {
  const {
    aiChoice,
    instanceType,
    allowedCidr,
    workspaceName,
    sessionTtlHours,
    teamSizeHint,
    workspaceUrl,
    authMode,
    trustedEmailHeader,
    trustedNameHeader,
    trustedGroupsHeader,
    trustedRoleHeader,
    owuiName,
    owuiEmail,
    owuiPassword
  } = req.body;

  if (currentOperation.status === 'running') {
    return res.status(409).json({
      ok: false,
      error: `Operation ${currentOperation.type} deja en cours`
    });
  }

  if (!AI_PULL_MAP[aiChoice]) {
    return res.status(400).json({ ok: false, error: 'aiChoice invalide' });
  }

  if (!INSTANCE_TYPES.has(instanceType)) {
    return res.status(400).json({ ok: false, error: 'instanceType invalide' });
  }

  if (!isValidIPv4Cidr(allowedCidr)) {
    return res.status(400).json({
      ok: false,
      error: 'allowedCidr doit etre un CIDR IPv4 restrictif, par exemple 203.0.113.10/32'
    });
  }

  if (!owuiEmail || (authMode === 'local_admin' && !owuiPassword)) {
    return res.status(400).json({
      ok: false,
      error: authMode === 'trusted_header'
        ? 'Email OpenWebUI requis'
        : 'Email et mot de passe OpenWebUI requis'
    });
  }

  if (!AUTH_MODES.has(authMode)) {
    return res.status(400).json({
      ok: false,
      error: 'authMode invalide'
    });
  }

  if (!isValidWorkspaceUrl(workspaceUrl)) {
    return res.status(400).json({ ok: false, error: 'workspaceUrl invalide' });
  }

  if (authMode === 'trusted_header' && (!workspaceUrl || workspaceUrl.trim() === '')) {
    return res.status(400).json({
      ok: false,
      error: 'Le mode trusted_header demande une URL d entreprise ou un proxy deja configure.'
    });
  }

  const finalSessionTtlHours = Number.parseInt(String(sessionTtlHours), 10);
  if (!Number.isInteger(finalSessionTtlHours) || finalSessionTtlHours < 1 || finalSessionTtlHours > 168) {
    return res.status(400).json({ ok: false, error: 'sessionTtlHours invalide' });
  }

  const finalTeamSizeHint = Number.parseInt(String(teamSizeHint), 10);
  if (!Number.isInteger(finalTeamSizeHint) || finalTeamSizeHint < 1 || finalTeamSizeHint > 200) {
    return res.status(400).json({ ok: false, error: 'teamSizeHint invalide' });
  }

  if (
    authMode === 'local_admin' &&
    (typeof owuiPassword !== 'string' || owuiPassword.length < 8 || /[\r\n]/.test(owuiPassword))
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Mot de passe OpenWebUI invalide'
    });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof owuiEmail !== 'string' || !emailPattern.test(owuiEmail.trim())) {
    return res.status(400).json({ ok: false, error: 'Email OpenWebUI invalide' });
  }

  let finalOwuiName;
  let finalOwuiEmail;
  let finalWorkspaceName;
  let finalTrustedEmailHeader;
  let finalTrustedNameHeader;
  let finalTrustedGroupsHeader;
  let finalTrustedRoleHeader;
  try {
    finalOwuiName =
      typeof owuiName === 'string' && owuiName.trim() !== ''
        ? assertPlainTextField(owuiName, 'Nom OpenWebUI', 80)
        : 'Admin';
    finalOwuiEmail = assertPlainTextField(owuiEmail, 'Email OpenWebUI', 160);
    finalWorkspaceName =
      typeof workspaceName === 'string' && workspaceName.trim() !== ''
        ? assertPlainTextField(workspaceName, 'Nom de session', 80)
        : 'Session IA';
    finalTrustedEmailHeader = assertHeaderName(
      trustedEmailHeader || 'X-User-Email',
      'Trusted email header'
    );
    finalTrustedNameHeader = assertHeaderName(
      trustedNameHeader || 'X-User-Name',
      'Trusted name header'
    );
    finalTrustedGroupsHeader = assertHeaderName(
      trustedGroupsHeader || 'X-User-Groups',
      'Trusted groups header'
    );
    finalTrustedRoleHeader = assertHeaderName(
      trustedRoleHeader || 'X-User-Role',
      'Trusted role header'
    );
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const finalAllowedCidr = allowedCidr.trim();
  const finalInstanceType = instanceType.trim();
  const finalWorkspaceSlug = slugifyWorkspaceName(finalWorkspaceName);
  const finalWorkspaceUrl = typeof workspaceUrl === 'string' ? workspaceUrl.trim() : '';
  const finalAuthMode = authMode;
  const finalOwuiPassword =
    finalAuthMode === 'trusted_header'
      ? crypto.randomBytes(18).toString('base64url')
      : owuiPassword;
  const finalWebuiSecretKey = crypto.randomBytes(48).toString('hex');
  const expectedModel = AI_PULL_MAP[aiChoice] || null;
  const accessNotes = buildAccessNotes(finalAuthMode, finalWorkspaceUrl, finalOwuiEmail);

  try {
    currentOperation.type = 'deploy';
    currentOperation.status = 'running';
    currentOperation.phase = 'terraform';
    currentOperation.cancelReadiness = false;
    currentOperation.logs = [];

    pushLog(
      `Nouvelle session equipe (${finalWorkspaceName}, auth_mode=${finalAuthMode}, instance=${finalInstanceType}, ttl=${finalSessionTtlHours}h)`,
      'info'
    );
    pushLog(`Compte bootstrap OpenWebUI: ${maskEmail(finalOwuiEmail)}`, 'info');
    pushLog(`CIDR autorise: ${finalAllowedCidr}`, 'info');
    if (expectedModel) {
      pushLog(`Modele attendu cote Ollama: ${expectedModel}`, 'info');
    }

    const tfvarsPath = path.join(TERRAFORM_DIR, 'terraform.tfvars');
    const tfvarsContent =
      `workspace_name = ${hclString(finalWorkspaceName)}\n` +
      `workspace_slug = ${hclString(finalWorkspaceSlug)}\n` +
      `session_ttl_hours = ${finalSessionTtlHours}\n` +
      `team_size_hint = ${finalTeamSizeHint}\n` +
      `ai_choice = ${hclString(aiChoice)}\n` +
      `instance_type = ${hclString(finalInstanceType)}\n` +
      `allowed_cidr = ${hclString(finalAllowedCidr)}\n` +
      `workspace_url = ${hclString(finalWorkspaceUrl)}\n` +
      `auth_mode = ${hclString(finalAuthMode)}\n` +
      `trusted_email_header = ${hclString(finalTrustedEmailHeader)}\n` +
      `trusted_name_header = ${hclString(finalTrustedNameHeader)}\n` +
      `trusted_groups_header = ${hclString(finalTrustedGroupsHeader)}\n` +
      `trusted_role_header = ${hclString(finalTrustedRoleHeader)}\n` +
      `owui_name = ${hclString(finalOwuiName)}\n` +
      `owui_email = ${hclString(finalOwuiEmail)}\n`;
    fs.writeFileSync(tfvarsPath, tfvarsContent);

    draftSessionState.active = true;
    draftSessionState.status = 'provisioning';
    draftSessionState.workspaceName = finalWorkspaceName;
    draftSessionState.workspaceSlug = finalWorkspaceSlug;
    draftSessionState.accessUrl = finalWorkspaceUrl || null;
    draftSessionState.instanceType = finalInstanceType;
    draftSessionState.modelLabel = expectedModel || aiChoice;
    draftSessionState.adminEmail = finalOwuiEmail;
    draftSessionState.accessNotes = accessNotes;
    draftSessionState.authMode = finalAuthMode;
    draftSessionState.teamSizeHint = finalTeamSizeHint;
    draftSessionState.sessionTtlHours = finalSessionTtlHours;
    draftSessionState.createdAt = new Date().toISOString();
    draftSessionState.expiresAt = new Date(Date.now() + finalSessionTtlHours * 60 * 60 * 1000).toISOString();
    persistState();

    pushLog(
      `terraform.tfvars mis a jour (workspace=${finalWorkspaceSlug}, instance=${finalInstanceType})`,
      'info'
    );

    await runTerraform(['init', '-input=false']);

    await runTerraform([
      'apply',
      '-auto-approve',
      `-var=workspace_name=${finalWorkspaceName}`,
      `-var=workspace_slug=${finalWorkspaceSlug}`,
      `-var=session_ttl_hours=${finalSessionTtlHours}`,
      `-var=team_size_hint=${finalTeamSizeHint}`,
      `-var=ai_choice=${aiChoice}`,
      `-var=instance_type=${finalInstanceType}`,
      `-var=allowed_cidr=${finalAllowedCidr}`,
      `-var=workspace_url=${finalWorkspaceUrl}`,
      `-var=auth_mode=${finalAuthMode}`,
      `-var=trusted_email_header=${finalTrustedEmailHeader}`,
      `-var=trusted_name_header=${finalTrustedNameHeader}`,
      `-var=trusted_groups_header=${finalTrustedGroupsHeader}`,
      `-var=trusted_role_header=${finalTrustedRoleHeader}`,
      `-var=owui_name=${finalOwuiName}`,
      `-var=owui_email=${finalOwuiEmail}`
    ], {
      TF_VAR_owui_password: finalOwuiPassword,
      TF_VAR_webui_secret_key: finalWebuiSecretKey
    });

    const ipOutput = terraformOutputRaw('ec2_public_ip');
    const instanceIdOutput = terraformOutputRaw('ec2_instance_id');
    const accessUrlOutput = terraformOutputRaw('workspace_access_url');

    if (ipOutput.status === 0) {
      const ip = ipOutput.stdout.trim();
      const instanceId =
        instanceIdOutput.status === 0 && instanceIdOutput.stdout.trim() !== ''
          ? instanceIdOutput.stdout.trim()
          : null;
      const accessUrl =
        accessUrlOutput.status === 0 && accessUrlOutput.stdout.trim() !== ''
          ? accessUrlOutput.stdout.trim()
          : `http://${ip}:3000`;
      pushLog(`IP publique session : ${ip}`, 'info');
      if (instanceId) {
        pushLog(`Instance AWS : ${instanceId}`, 'info');
      }
      pushLog(`URL de session : ${accessUrl}`, 'success');

      sessionState.active = true;
      sessionState.status = 'provisioning';
      sessionState.workspaceName = finalWorkspaceName;
      sessionState.workspaceSlug = finalWorkspaceSlug;
      sessionState.accessUrl = accessUrl;
      sessionState.instanceType = finalInstanceType;
      sessionState.modelLabel = expectedModel || aiChoice;
      sessionState.adminEmail = finalOwuiEmail;
      sessionState.accessNotes = accessNotes;
      sessionState.authMode = finalAuthMode;
      sessionState.teamSizeHint = finalTeamSizeHint;
      sessionState.sessionTtlHours = finalSessionTtlHours;
      sessionState.createdAt = new Date().toISOString();
      sessionState.expiresAt = new Date(Date.now() + finalSessionTtlHours * 60 * 60 * 1000).toISOString();
      sessionSecrets.adminEmail = finalOwuiEmail;
      sessionSecrets.adminPassword = finalOwuiPassword;
      sessionSecrets.jwt = null;
      sessionSecrets.jwtExpiresAt = null;
      sessionSecrets.launchToken = null;
      sessionSecrets.launchTokenExpiresAt = null;
      persistState();

      currentOperation.phase = 'readiness';
      const readiness = await waitForIaReady(ip, finalInstanceType, expectedModel, instanceId);
      if (readiness.cancelled) {
        currentOperation.type = 'idle';
        currentOperation.status = 'idle';
        currentOperation.phase = 'idle';
        currentOperation.cancelReadiness = false;
        pushLog(
          'Deploy interrompu pendant les tentatives readiness pour permettre une destruction',
          'info'
        );
        return res.status(409).json({
          ok: false,
          error: 'Deploy interrompu pour permettre la destruction'
        });
      }
      if (readiness.ready) {
        if (finalAuthMode === 'trusted_header') {
          pushLog(
            `Mode trusted_header actif: fais passer ${finalTrustedEmailHeader} via ton proxy d'entreprise`,
            'success'
          );
        } else {
          pushLog(
            `Mode local_admin actif: utilise ${maskEmail(finalOwuiEmail)} pour l'administration initiale`,
            'success'
          );
        }
        sessionState.status = 'ready';
        draftSessionState.status = 'ready';
        persistState();
      }
    } else {
      pushLog('Impossible de recuperer ec2_public_ip', 'error');
    }

    currentOperation.status = 'success';
    currentOperation.phase = 'idle';
    currentOperation.cancelReadiness = false;
    currentOperation.type = 'idle';
    scheduleDestroyFromTtl(finalSessionTtlHours);

    return res.json({ ok: true });
  } catch (e) {
    currentOperation.status = 'error';
    currentOperation.phase = 'idle';
    currentOperation.cancelReadiness = false;
    const message = String(e && e.message ? e.message : e);
    if (message.includes('VcpuLimitExceeded')) {
      const quotaHelp =
        'Quota AWS vCPU insuffisant pour cette instance. ' +
        'Utilise g4dn.xlarge (4 vCPU) ou demande une augmentation de quota EC2 vCPU.';
      pushLog(quotaHelp, 'error');
      pushLog(`Erreur deploy: ${message}`, 'error');
      return res.status(409).json({ ok: false, error: quotaHelp });
    }

    pushLog(`Erreur deploy: ${message}`, 'error');
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post(
  '/api/destroy',

  authMiddleware.authenticate,

  authMiddleware.requireRole(
    'owner',
    'admin'
  ),

  requireAdminToken,

  async (req, res) => {
  if (currentOperation.status === 'running') {
    const canInterruptReadiness =
      currentOperation.type === 'deploy' && currentOperation.phase === 'readiness';

    if (canInterruptReadiness) {
      pushLog(
        'Destruction demandee pendant les tentatives readiness, interruption en cours...',
        'info'
      );
      currentOperation.cancelReadiness = true;

      const released = await waitForOperationToLeaveRunning(30000);
      if (!released) {
        return res.status(409).json({
          ok: false,
          error:
            'Impossible d interrompre le deploy pour le moment. Reessaie dans quelques secondes.'
        });
      }
    } else {
      return res.status(409).json({
        ok: false,
        error: `Operation ${currentOperation.type} deja en cours`
      });
    }
  }

  try {
    await destroySessionInternal('manual');
    return res.json({ ok: true });
  } catch (e) {
    currentOperation.status = 'error';
    currentOperation.phase = 'idle';
    currentOperation.cancelReadiness = false;
    pushLog(`Erreur destroy: ${e.message}`, 'error');
    return res.status(500).json({ ok: false, error: e.message });
  }
});

restorePersistedSession();

proxyApp.get('/launch/:token', async (req, res) => {
  try {
    assertLocalAdminReady();
    if (
      !sessionSecrets.launchToken ||
      req.params.token !== sessionSecrets.launchToken ||
      !sessionSecrets.launchTokenExpiresAt ||
      new Date(sessionSecrets.launchTokenExpiresAt).getTime() <= Date.now()
    ) {
      return res.status(403).send('Lien d ouverture expire ou invalide');
    }

    const jwt = await ensureOpenWebUiJwt();
    const remainingMs = Math.max(
      60 * 1000,
      new Date(sessionSecrets.launchTokenExpiresAt).getTime() - Date.now()
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Set-Cookie',
      `${PROXY_COOKIE_NAME}=${sessionSecrets.launchToken}; Max-Age=${Math.floor(remainingMs / 1000)}; Path=/; HttpOnly; SameSite=Lax`
    );
    return res.end(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=/" />
    <title>Ouverture de la session</title>
  </head>
  <body>
    <script>
      try {
        localStorage.setItem('token', ${JSON.stringify(jwt)});
        localStorage.setItem('auth-token', ${JSON.stringify(jwt)});
        sessionStorage.setItem('token', ${JSON.stringify(jwt)});
        window.localStorage.token = ${JSON.stringify(jwt)};
      } catch (error) {}
      window.location.replace('/');
    </script>
  </body>
</html>`);
  } catch (error) {
    return res.status(409).send(error.message);
  }
});

proxyApp.get('/auth', (req, res, next) => {
  const cookieToken = getCookieValue(req, PROXY_COOKIE_NAME);
  if (
    cookieToken &&
    sessionSecrets.launchToken &&
    cookieToken === sessionSecrets.launchToken &&
    sessionSecrets.jwt
  ) {
    return res.redirect('/');
  }
  return next();
});

proxyApp.use(async (req, res) => {
  try {
    assertLocalAdminReady();
    const cookieToken = getCookieValue(req, PROXY_COOKIE_NAME);
    if (
      !cookieToken ||
      !sessionSecrets.launchToken ||
      cookieToken !== sessionSecrets.launchToken ||
      !sessionSecrets.launchTokenExpiresAt ||
      new Date(sessionSecrets.launchTokenExpiresAt).getTime() <= Date.now()
    ) {
      return res.status(403).send('Ouverture automatique invalide. Reviens dans TerminIAtor.');
    }

    const jwt = await ensureOpenWebUiJwt();
    return proxyRequestToOpenWebUi(req, res, jwt);
  } catch (error) {
    return res.status(502).send(`Proxy OpenWebUI indisponible: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Serveur backend demarre sur http://localhost:${PORT}`);
  console.log(`Dossier Terraform : ${TERRAFORM_DIR}`);
  if (ADMIN_TOKEN_ENABLED) {
    console.log('Token admin active via TERMINIATOR_ADMIN_TOKEN');
  } else {
    console.log('Mode sans token admin actif pour cette session');
  }
});

const proxyServer = proxyApp.listen(PROXY_PORT, () => {
  console.log(`Passerelle OpenWebUI demarree sur http://localhost:${PROXY_PORT}`);
});

proxyServer.on('upgrade', proxyUpgradeToOpenWebUi);
