const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const database = require('./src/database/database');
const healthRoutes = require('./src/routes/health.routes');

const validationMiddleware = require(
  './src/middleware/validation.middleware'
);

const {
  notFoundHandler,
  errorHandler
} = require('./src/middleware/error-handler');

const groupRepository = require('./src/repositories/group.repository');
const usageRepository = require('./src/repositories/usage.repository');
const config = require('./src/config/env');
const sessionRepository = require(
  './src/repositories/session.repository'
);
const terraformService = require(
  './src/services/terraform.service'
);
const authRoutes = require(
  './src/routes/auth.routes'
);
const adminRoutes = require(
  './src/routes/admin.routes'
);
const invitationRoutes = require(
  './src/routes/invitation.routes'
);
const sessionRoutes = require(
  './src/routes/session.routes'
);
const authMiddleware = require(
  './src/middleware/auth.middleware'
);
const app = express();
const proxyApp = express();
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  proxyApp.set('trust proxy', 1);
}
proxyApp.use(authMiddleware.authenticate);

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

  app.use(
  helmet({
    // Désactivée provisoirement pour éviter de casser l’interface existante.
    // On configurera une vraie CSP plus tard.
    contentSecurityPolicy: false
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de tentatives de connexion. Réessaie dans 15 minutes.'
  }
});

const mfaVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives MFA. Réessaie dans 15 minutes.' } });
const mfaManagementLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives. Réessaie dans 15 minutes.' } });



app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/mfa/verify', mfaVerifyLimiter);
app.use('/api/auth/mfa/recovery', mfaVerifyLimiter);
app.use('/api/auth/mfa/setup', mfaManagementLimiter);
app.use('/api/auth/mfa/confirm', mfaManagementLimiter);
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origine non autorisee par CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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
app.use(
  '/api/invitations',
  invitationRoutes
);
app.use(
  '/api/sessions',
  sessionRoutes
);
app.use(express.static('public'));

const clients = [];

// Les opérations Terraform sont isolées par session.
// AsyncLocalStorage permet aux logs Terraform/readiness de rester rattachés
// à la bonne opération même lorsque plusieurs workspaces sont provisionnés
// en parallèle.
const operationContext = new AsyncLocalStorage();
const sessionOperations = new Map();
const pendingDeployOperationsByUser = new Map();

function createOperation({
  type,
  sessionId = null,
  userId = null,
  tenantId = null,
}) {
  return {
    id: crypto.randomUUID(),
    type,
    status: 'running',
    phase: 'terraform',
    cancelReadiness: false,
    sessionId,
    userId,
    tenantId,
    logs: [],
    startedAt: new Date().toISOString(),
  };
}

function getCurrentOperation() {
  return operationContext.getStore() || null;
}

function getRunningOperationForSession(sessionId) {
  if (!sessionId) return null;

  const operation = sessionOperations.get(sessionId) || null;

  return operation?.status === 'running'
    ? operation
    : null;
}

function getRunningDeployForUser(userId) {
  if (!userId) return null;

  const operation =
    pendingDeployOperationsByUser.get(userId) || null;

  if (
    operation?.type === 'deploy' &&
    operation.status === 'running'
  ) {
    return operation;
  }

  for (const candidate of sessionOperations.values()) {
    if (
      candidate.userId === userId &&
      candidate.type === 'deploy' &&
      candidate.status === 'running'
    ) {
      return candidate;
    }
  }

  return null;
}

function bindOperationToSession(operation, sessionId) {
  if (!operation || !sessionId) return;

  operation.sessionId = sessionId;
  sessionOperations.set(sessionId, operation);

  if (
    operation.userId &&
    pendingDeployOperationsByUser.get(operation.userId) === operation
  ) {
    pendingDeployOperationsByUser.delete(operation.userId);
  }
}

function getVisibleOperationForUser(
  userId,
  accessibleSessions = []
) {
  const pending =
    pendingDeployOperationsByUser.get(userId) || null;

  if (pending?.status === 'running') {
    return pending;
  }

  const accessibleSessionIds = new Set(
    accessibleSessions
      .map((session) => session?.id)
      .filter(Boolean)
  );

  const candidates = Array.from(
    sessionOperations.values()
  ).filter((operation) =>
    operation.userId === userId ||
    accessibleSessionIds.has(operation.sessionId)
  );

  candidates.sort((left, right) => {
    const runningDifference =
      Number(right.status === 'running') -
      Number(left.status === 'running');

    if (runningDifference !== 0) {
      return runningDifference;
    }

    return (
      new Date(right.startedAt).getTime() -
      new Date(left.startedAt).getTime()
    );
  });

  return candidates[0] || null;
}

function getReplayLogsForUser(userId) {
  const operations = new Set(
    sessionOperations.values()
  );

  const pending =
    pendingDeployOperationsByUser.get(userId);

  if (pending) {
    operations.add(pending);
  }

  return Array.from(operations)
    .filter((operation) => operation.userId === userId)
    .flatMap((operation) => operation.logs)
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime()
    );
}

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
  sessionTtlHours: null,
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

// Les identifiants/JWT OpenWebUI sont isolés par session.
// Un token de lancement est également lié à un userId + tenantId + sessionId.
const sessionSecretsById = new Map();
const launchTokens = {};

// Un timer TTL par session : la création d'une seconde session n'annule plus
// le timer de destruction de la première.
const ttlDestroyTimers = new Map();
const EXPIRED_SESSION_CLEANUP_INTERVAL_MS =
  5 * 60 * 1000;
const PROXY_COOKIE_NAME = 'privalyse_launch_token';

// Les destructions Terraform sont sérialisées globalement.
// Les déploiements peuvent rester parallèles, mais deux `terraform destroy`
// ne sont jamais exécutés en même temps. C'est volontairement conservateur
// pour supprimer tout risque de croisement pendant le durcissement multi-session.
let destroyExecutionTail = Promise.resolve();
let destroyExecutionQueueDepth = 0;

async function withSerializedDestroy(
  sessionId,
  callback
) {
  const previousExecution = destroyExecutionTail;
  let releaseExecution;

  destroyExecutionTail = new Promise((resolve) => {
    releaseExecution = resolve;
  });

  destroyExecutionQueueDepth += 1;

  if (destroyExecutionQueueDepth > 1) {
    pushLog(
      `Destruction de la session ${sessionId} mise en file d attente de securite.`,
      'info'
    );
  }

  await previousExecution;

  try {
    return await callback();
  } finally {
    destroyExecutionQueueDepth = Math.max(
      0,
      destroyExecutionQueueDepth - 1
    );
    releaseExecution();
  }
}

const AI_PULL_MAP = {
  'qwen-mini': 'qwen2.5:0.5b',
  'llama3-1b': 'llama3.2:1b'
};

const AUTH_MODES = new Set([
  'local_admin',
  'trusted_header'
]);

const DEFAULT_INSTANCE_TYPE = 'a4-ram8-disk0';

const INSTANCE_TYPES = new Set([
  DEFAULT_INSTANCE_TYPE
]);

const DEFAULT_DEPLOYMENT_CONFIG = Object.freeze({
  aiChoice: 'qwen-mini',

  individualInstanceType:
    DEFAULT_INSTANCE_TYPE,

  teamInstanceType:
    DEFAULT_INSTANCE_TYPE,

  allowedCidr:
    config.workspace.allowedCidr ||
    '127.0.0.1/32',

  authMode: 'local_admin',

  workspaceUrl: '',

  trustedEmailHeader: 'X-User-Email',
  trustedNameHeader: 'X-User-Name',
  trustedGroupsHeader: 'X-User-Groups',
  trustedRoleHeader: 'X-User-Role',

  owuiName: 'Privalyse',

  owuiEmail:
    config.workspace.owuiEmail
});
function requireAdminToken(req, res, next) {
  if (!ADMIN_TOKEN_ENABLED) {
    next();
    return;
  }

  const provided =
    req.get('X-Privalyse-Admin-Token') || '';

  if (provided === ADMIN_TOKEN) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error:
      'Token administrateur Privalyse invalide ou manquant'
  });
}


async function requireSessionAccess(
  req,
  res,
  next
) {
  try {
    const sessionId = String(
      req.body?.sessionId ||
      req.params?.sessionId ||
      req.query?.sessionId ||
      ''
    ).trim();

    // Fail-closed : aucune route de session ne doit choisir
    // implicitement la première session accessible.
    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        error: 'Identifiant de session manquant'
      });
    }

    if (!isUuid(sessionId)) {
      return res.status(400).json({
        ok: false,
        error: 'Identifiant de session invalide'
      });
    }

    const allowed =
      await sessionRepository.canUserAccessSession(
        sessionId,
        req.auth.userId,
        req.auth.tenantId
      );

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Acces refuse a cette session'
      });
    }

    req.sessionId = sessionId;
    next();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        'Impossible de verifier l acces a la session'
    });
  }
}

/**
 * Variante fail-closed réservée aux actions destructives.
 *
 * Contrairement à requireSessionAccess, aucun fallback n'est autorisé :
 * l'identifiant de session doit être fourni explicitement dans le body.
 */
async function requireExplicitDestroySessionAccess(
  req,
  res,
  next
) {
  const sessionId =
    typeof req.body?.sessionId === 'string'
      ? req.body.sessionId.trim()
      : '';

  if (!sessionId) {
    return res.status(400).json({
      ok: false,
      error:
        'Identifiant de session obligatoire pour la destruction'
    });
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId
    )
  ) {
    return res.status(400).json({
      ok: false,
      error:
        'Identifiant de session invalide pour la destruction'
    });
  }

  try {
    const allowed =
      await sessionRepository.canUserAccessSession(
        sessionId,
        req.auth.userId,
        req.auth.tenantId
      );

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Acces refuse a cette session'
      });
    }

    req.sessionId = sessionId;
    return next();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        'Impossible de verifier l acces a la session'
    });
  }
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
  target.databaseSessionId = null;
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
  target.sessionMode = null;
  target.groupId = null;
  target.createdAt = null;
  target.expiresAt = null;
}
function createSessionSecrets() {
  return {
    adminEmail: null,
    adminPassword: null,
    authMode: 'local_admin',
    jwt: null,
    jwtExpiresAt: null,
  };
}

function getSessionSecretsForId(
  sessionId,
  createIfMissing = false
) {
  if (!sessionId) return null;

  if (
    !sessionSecretsById.has(sessionId) &&
    createIfMissing
  ) {
    sessionSecretsById.set(
      sessionId,
      createSessionSecrets()
    );
  }

  return sessionSecretsById.get(sessionId) || null;
}

function deleteLaunchTokensForSession(sessionId) {
  for (const [token, entry] of Object.entries(launchTokens)) {
    if (entry?.sessionId === sessionId) {
      delete launchTokens[token];
    }
  }
}

function clearSessionSecrets(sessionId = null) {
  if (sessionId) {
    sessionSecretsById.delete(sessionId);
    deleteLaunchTokensForSession(sessionId);
    return;
  }

  sessionSecretsById.clear();
  for (const token of Object.keys(launchTokens)) {
    delete launchTokens[token];
  }
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

function pushLog(
  message,
  type = 'info',
  operationOverride = null
) {
  const operation =
    operationOverride || getCurrentOperation();

  const log = {
    message,
    type,
    timestamp: new Date().toISOString(),
    sessionId: operation?.sessionId || null,
    userId: operation?.userId || null,
  };

  if (operation) {
    operation.logs.push(log);

    // Evite une croissance mémoire illimitée sur les opérations longues.
    if (operation.logs.length > 1000) {
      operation.logs.splice(
        0,
        operation.logs.length - 1000
      );
    }
  }

  // Les logs d'une création/destruction ne sont envoyés qu'au compte
  // qui a déclenché l'opération. Les logs de maintenance sans userId
  // restent côté serveur pour éviter toute fuite inter-utilisateur.
  if (!log.userId) return;

  const data = `data: ${JSON.stringify(log)}\n\n`;

  clients.forEach((client) => {
    if (client.userId === log.userId) {
      client.res.write(data);
    }
  });
}

function persistState() {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          sessionState,
          draftSessionState,
          sessionSecretsById: Object.fromEntries(
            sessionSecretsById.entries()
          ),
          launchTokens,
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
    sessionSecretsById.clear();

    if (
      parsed &&
      parsed.sessionSecretsById &&
      typeof parsed.sessionSecretsById === 'object'
    ) {
      for (const [sessionId, secrets] of Object.entries(
        parsed.sessionSecretsById
      )) {
        if (secrets && typeof secrets === 'object') {
          sessionSecretsById.set(sessionId, secrets);
        }
      }
    } else if (
      parsed &&
      parsed.sessionSecrets &&
      typeof parsed.sessionSecrets === 'object' &&
      sessionState.databaseSessionId
    ) {
      // Migration transparente depuis l'ancien fichier d'état mono-session.
      const legacySecrets = {
        adminEmail: parsed.sessionSecrets.adminEmail || null,
        adminPassword: parsed.sessionSecrets.adminPassword || null,
        authMode: sessionState.authMode || 'local_admin',
        jwt: parsed.sessionSecrets.jwt || null,
        jwtExpiresAt: parsed.sessionSecrets.jwtExpiresAt || null,
      };

      sessionSecretsById.set(
        sessionState.databaseSessionId,
        legacySecrets
      );

      if (
        parsed.sessionSecrets.launchTokens &&
        typeof parsed.sessionSecrets.launchTokens === 'object'
      ) {
        Object.assign(
          launchTokens,
          parsed.sessionSecrets.launchTokens
        );
      }
    }

    if (
      parsed &&
      parsed.launchTokens &&
      typeof parsed.launchTokens === 'object'
    ) {
      Object.assign(launchTokens, parsed.launchTokens);
    }
  } catch (error) {
    pushLog(`Etat persiste ignore: ${error.message}`, 'error');
  }
}

function clearScheduledDestroy(sessionId = null) {
  if (!sessionId) {
    for (const timer of ttlDestroyTimers.values()) {
      clearTimeout(timer);
    }
    ttlDestroyTimers.clear();
    return;
  }

  const timer = ttlDestroyTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    ttlDestroyTimers.delete(sessionId);
  }
}

async function destroySessionInternal(
  sessionId,
  reason = 'manual'
) {
  return destroyInfraInternal(
    sessionId,
    reason
  );
}

async function destroyInfraInternal(
  sessionId,
  reason = 'manual'
) {
  let operation = getCurrentOperation();

  if (!operation) {
    operation = createOperation({
      type: 'destroy',
      sessionId,
    });
    bindOperationToSession(operation, sessionId);
  }

  operation.type = 'destroy';
  operation.status = 'running';
  operation.phase = 'terraform';
  operation.cancelReadiness = false;
  operation.sessionId = sessionId;
  operation.logs = [];

  pushLog(
    `Destruction complete demandee pour la session ${sessionId} (${reason})`,
    'info',
    operation
  );

  let destroySucceeded = false;

  try {
    await withSerializedDestroy(
      sessionId,
      async () => {
        // Relire la session une fois le verrou de destruction obtenu.
        // Cela évite de valider une cible puis d'attendre pendant qu'un autre
        // destroy modifie l'état global.
        const databaseSession =
          await sessionRepository.getSessionById(
            sessionId
          );

        if (!databaseSession) {
          throw new Error('Session introuvable.');
        }

        if (databaseSession.status === 'destroyed') {
          throw new Error(
            'Cette session est deja detruite.'
          );
        }

        const destroyTarget =
          validateDestroyTargetAgainstDatabase(
            databaseSession
          );

        await runTerraform(
          [
            'destroy',
            '-auto-approve'
          ],
          {
            TF_VAR_allowed_cidr:
              config.workspace.allowedCidr ||
              '127.0.0.1/32',

            TF_VAR_webui_secret_key:
              crypto.randomBytes(48).toString('hex')
          },
          destroyTarget.workingDirectory
        );

        const destroyedSession =
          await sessionRepository.markSessionDestroyed(
            sessionId
          );

        if (!destroyedSession) {
          throw new Error(
            'Infrastructure detruite mais mise a jour PostgreSQL impossible.'
          );
        }

        destroySucceeded = true;
      }
    );
 } finally {
  if (destroySucceeded) {
    clearScheduledDestroy(sessionId);
    clearSessionSecrets(sessionId);

    try {
  const removed =
    removeSessionTerraformDirectory(sessionId);

  if (removed) {
    pushLog(
      `Dossier Terraform local supprime pour ${sessionId}.`,
      'success',
      operation
    );
  }

  await sessionRepository.clearDestroyedSessionInfrastructureMetadata(
    sessionId
  );
} catch (cleanupError) {
  pushLog(
    `Infrastructure detruite mais nettoyage local incomplet: ${cleanupError.message}`,
    'error',
    operation
  );
}

    if (
      sessionState.databaseSessionId === sessionId
    ) {
      clearSessionLikeState(sessionState);
      clearSessionLikeState(draftSessionState);
    }

    persistState();
  }

  operation.status =
    destroySucceeded ? 'success' : 'error';

  operation.phase = 'idle';

  operation.type =
    destroySucceeded ? 'idle' : operation.type;
}
}

function scheduleDestroyFromTtl(
  sessionId,
  expiresAt
) {
  clearScheduledDestroy(sessionId);

  const expiresMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresMs)) {
    pushLog(
      `TTL non programme pour ${sessionId}: date d'expiration invalide.`,
      'error'
    );
    return;
  }

  // Le timer est calculé depuis la vraie date expires_at PostgreSQL.
  // Pour les nouvelles sessions, expires_at est recalculé au premier ready
  // afin que l'utilisateur bénéficie réellement de 1h / 2h / 3h d'usage.
  const remainingMs = Math.max(
    0,
    expiresMs - Date.now()
  );

  const runDestroy = async () => {
    // Une opération active sur CETTE session repousse seulement sa destruction.
    if (getRunningOperationForSession(sessionId)) {
      const retryTimer = setTimeout(
        runDestroy,
        60 * 1000
      );

      ttlDestroyTimers.set(
        sessionId,
        retryTimer
      );

      return;
    }

    const operation = createOperation({
      type: 'destroy',
      sessionId,
      userId: null,
      tenantId: null,
    });

    bindOperationToSession(
      operation,
      sessionId
    );

    await operationContext.run(
      operation,
      async () => {
        pushLog(
          `Expiration atteinte. Lancement de la destruction automatique de la session ${sessionId}.`,
          'info'
        );

        try {
          await destroySessionInternal(
            sessionId,
            'ttl'
          );
        } catch (error) {
          operation.status = 'error';
          operation.phase = 'idle';
          operation.cancelReadiness = false;

          pushLog(
            `Echec de la destruction TTL de la session ${sessionId} : ${error.message}`,
            'error'
          );

          persistState();
        }
      }
    );
  };

  const timer = setTimeout(
    runDestroy,
    remainingMs
  );

  ttlDestroyTimers.set(
    sessionId,
    timer
  );
}
/**
 * Détruit les infrastructures associées aux sessions
 * PostgreSQL dont la date d'expiration est dépassée.
 */
async function cleanupExpiredSessions() {
  const expiredSessions =
    await sessionRepository.listExpiredSessions(10);

  if (expiredSessions.length === 0) {
    return;
  }

  pushLog(
    `${expiredSessions.length} session(s) expirée(s) détectée(s).`,
    'info'
  );

  for (const expiredSession of expiredSessions) {
    // Un deploy/destroy actif ne bloque que sa propre session.
    if (
      getRunningOperationForSession(
        expiredSession.id
      )
    ) {
      continue;
    }

    const operation = createOperation({
      type: 'destroy',
      sessionId: expiredSession.id,
      userId: null,
      tenantId: null,
    });

    bindOperationToSession(
      operation,
      expiredSession.id
    );

    await operationContext.run(
      operation,
      async () => {
        try {
          pushLog(
            `Destruction automatique de la session expirée ${expiredSession.id}.`,
            'info'
          );

          await destroySessionInternal(
            expiredSession.id,
            'expired-cleanup'
          );

          pushLog(
            `Session expirée ${expiredSession.id} détruite.`,
            'success'
          );
        } catch (error) {
          operation.status = 'error';
          operation.phase = 'idle';
          operation.cancelReadiness = false;

          pushLog(
            `Impossible de détruire la session expirée ${expiredSession.id} : ${error.message}`,
            'error'
          );
        }
      }
    );
  }
}
async function restoreScheduledDestroysFromDatabase() {
  const sessions =
    await sessionRepository.listFutureExpiringSessions(1000);

  for (const session of sessions) {
    scheduleDestroyFromTtl(
      session.id,
      session.expires_at
    );

    pushLog(
      `Timer TTL restaure pour ${session.id}, expiration ${new Date(
        session.expires_at
      ).toISOString()}.`,
      'info'
    );
  }

  if (sessions.length > 0) {
    pushLog(
      `${sessions.length} timer(s) TTL restaure(s) depuis PostgreSQL.`,
      'success'
    );
  }
}
function restorePersistedSession() {
  // Les états/secrets par session sont restaurés pour permettre la
  // réouverture des workspaces après un redémarrage du backend.
  // Les expirations sont reprises par cleanupExpiredSessions().
  loadPersistedState();
}

app.get(
  '/api/stream',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  (req, res) => {
    if (
      ADMIN_TOKEN_ENABLED &&
      (req.query.token || '') !== ADMIN_TOKEN
    ) {
      return res.status(401).json({
        ok: false,
        error: 'Token administrateur Privalyse invalide ou manquant'
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    getReplayLogsForUser(
      req.auth.userId
    ).forEach((log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    const client = {
      res,
      userId: req.auth.userId,
      tenantId: req.auth.tenantId,
    };

    clients.push(client);

    req.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });
  }
);

app.get(
  '/api/session',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  requireAdminToken,
  async (req, res) => {
    try {
      const accessibleSessions =
        await sessionRepository.listSessionsForUser(
          req.auth.userId,
          req.auth.tenantId,
          false
        );

      const ownedActiveSessions =
        accessibleSessions.filter(
          (item) =>
            item.created_by_user_id === req.auth.userId
        );

      const requestedSessionId =
        typeof req.query?.sessionId === 'string'
          ? req.query.sessionId.trim()
          : '';

      if (requestedSessionId && !isUuid(requestedSessionId)) {
        return res.status(400).json({
          ok: false,
          error: 'Identifiant de session invalide'
        });
      }

      let databaseSession = null;

      if (requestedSessionId) {
        databaseSession =
          accessibleSessions.find(
            (item) => item.id === requestedSessionId
          ) || null;

        if (!databaseSession) {
          return res.status(403).json({
            ok: false,
            error: 'Acces refuse a cette session'
          });
        }
      } else if (accessibleSessions.length === 1) {
        // Sélection automatique uniquement lorsqu'il n'existe aucune ambiguïté.
        databaseSession = accessibleSessions[0];
      }

      let session = null;

      if (databaseSession) {
        const secrets =
          getSessionSecretsForId(
            databaseSession.id,
            false
          );

        const memberCount = Number(
          databaseSession.member_count || 1
        );

        session = {
          active:
            databaseSession.status !== 'destroyed',
          databaseSessionId: databaseSession.id,
          status: databaseSession.status,
          workspaceName: databaseSession.name,
          workspaceSlug: databaseSession.slug,
          accessUrl: databaseSession.access_url,
          authMode:
            secrets?.authMode || 'local_admin',
          sessionMode:
            databaseSession.session_mode === 'team'
              ? 'team'
              : 'individual',
          teamSizeHint: memberCount,
          createdAt: databaseSession.created_at,
          readyAt: databaseSession.ready_at,
          sessionTtlHours: databaseSession.session_ttl_hours,
          expiresAt:
            databaseSession.status === 'ready'
              ? databaseSession.expires_at
              : null,
          autoOpenAvailable:
            databaseSession.status === 'ready' &&
            Boolean(
              secrets?.adminEmail &&
              secrets?.adminPassword
            ),
          proxyUrl:
            databaseSession.status === 'ready'
              ? getProxyBaseUrl(req)
              : null,
          now: new Date().toISOString(),
        };
      }

      const visibleOperation =
        getVisibleOperationForUser(
          req.auth.userId,
          accessibleSessions
        );

      return res.json({
        ok: true,
        session,
        draftSession: null,
        selectionRequired:
          !databaseSession && accessibleSessions.length > 1,
        selectedSessionId:
          databaseSession?.id || null,
        canCreateSession:
          ownedActiveSessions.length === 0,
        ownedActiveSessionIds:
          ownedActiveSessions.map((item) => item.id),
        sessions: accessibleSessions.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          expiresAt:
            item.status === 'ready'
              ? item.expires_at
              : null,
          sessionTtlHours: item.session_ttl_hours,
          sessionMode:
            item.session_mode === 'team'
              ? 'team'
              : 'individual',
          memberCount: Number(item.member_count || 1),
          isOwner:
            item.created_by_user_id === req.auth.userId,
        })),
        operation: visibleOperation
          ? {
              type: visibleOperation.type,
              status: visibleOperation.status,
              phase: visibleOperation.phase,
              sessionId: visibleOperation.sessionId,
            }
          : {
              type: 'idle',
              status: 'idle',
              phase: 'idle',
              sessionId: null,
            },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          'Impossible de charger les sessions accessibles.'
      });
    }
  }
);

app.post(
  '/api/session/open',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  requireSessionAccess,
  async (req, res) => {
    try {
      const sessionId = req.sessionId;

      await assertLocalAdminReady(sessionId);
      await ensureOpenWebUiJwt(sessionId);

      try {
        await usageRepository.recordAccess(
          sessionId,
          req.auth.userId
        );
      } catch (usageError) {
        pushLog(
          `Suivi d acces non enregistre pour ${sessionId}: ${usageError.message}`,
          'error',
          {
            sessionId,
            userId: req.auth.userId,
            tenantId: req.auth.tenantId,
          }
        );
      }

const launchToken =
  crypto.randomBytes(24).toString('base64url');

const launchTokenExpiresAt = new Date(
  Date.now() + 15 * 60 * 1000
).toISOString();

launchTokens[launchToken] = {
  userId: req.auth.userId,
  tenantId: req.auth.tenantId,
  sessionId,
  expiresAt: launchTokenExpiresAt
};
      persistState();

      return res.json({
        ok: true,
        openUrl: `${getProxyBaseUrl(req)}/launch/${launchToken}`
      });
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: error.message
      });
    }
  }
);

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
function getSessionTerraformDirectory(sessionId) {
  const normalizedSessionId =
    String(sessionId || '').trim();

  if (
    !normalizedSessionId ||
    !/^[a-zA-Z0-9_-]+$/.test(normalizedSessionId)
  ) {
    throw new Error(
      'Identifiant de session invalide pour Terraform'
    );
  }

  const sessionsRootDirectory = path.join(
    __dirname,
    'terraform-sessions'
  );

  return path.join(
    sessionsRootDirectory,
    normalizedSessionId
  );
}

function getTerraformSessionsRootDirectory() {
  return path.resolve(
    __dirname,
    'terraform-sessions'
  );
}
function removeSessionTerraformDirectory(
  sessionId,
  explicitWorkingDirectory = null
) {
  const sessionsRootDirectory =
    getTerraformSessionsRootDirectory();

  const expectedDirectory = path.resolve(
    getSessionTerraformDirectory(sessionId)
  );

  if (
    explicitWorkingDirectory &&
    path.resolve(String(explicitWorkingDirectory)) !== expectedDirectory
  ) {
    throw new Error(
      `Nettoyage Terraform refuse: dossier incoherent pour ${sessionId}.`
    );
  }

  if (
    path.dirname(expectedDirectory) !== sessionsRootDirectory
  ) {
    throw new Error(
      `Nettoyage Terraform refuse: chemin hors de terraform-sessions pour ${sessionId}.`
    );
  }

  if (!fs.existsSync(expectedDirectory)) {
    return false;
  }

  const stats = fs.lstatSync(expectedDirectory);

  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory()
  ) {
    throw new Error(
      `Nettoyage Terraform refuse: dossier non fiable pour ${sessionId}.`
    );
  }

  const realRootDirectory =
    fs.realpathSync(sessionsRootDirectory);

  const realSessionDirectory =
    fs.realpathSync(expectedDirectory);

  const expectedRealDirectory =
    path.join(realRootDirectory, String(sessionId));

  if (
    realSessionDirectory !== expectedRealDirectory
  ) {
    throw new Error(
      `Nettoyage Terraform refuse: chemin reel inattendu pour ${sessionId}.`
    );
  }

  fs.rmSync(realSessionDirectory, {
    recursive: true,
    force: false,
  });

  return true;
}
function assertSafeTerraformStateLocation(
  databaseSession,
  explicitWorkingDirectory = null
) {
  if (!databaseSession?.id) {
    throw new Error(
      'Protection destruction: session PostgreSQL invalide.'
    );
  }

  const sessionId = String(databaseSession.id).trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId
    )
  ) {
    throw new Error(
      'Protection destruction: UUID de session invalide.'
    );
  }

  if (!databaseSession.terraform_directory) {
    throw new Error(
      'Protection destruction: dossier Terraform absent en PostgreSQL.'
    );
  }

  const sessionsRootDirectory =
    getTerraformSessionsRootDirectory();

  const expectedDirectory = path.resolve(
    getSessionTerraformDirectory(sessionId)
  );

  const databaseDirectory = path.resolve(
    String(databaseSession.terraform_directory)
  );

  if (databaseDirectory !== expectedDirectory) {
    throw new Error(
      `Protection destruction: dossier Terraform incoherent pour ${sessionId}.`
    );
  }

  if (
    explicitWorkingDirectory &&
    path.resolve(String(explicitWorkingDirectory)) !== expectedDirectory
  ) {
    throw new Error(
      `Protection destruction: dossier Terraform d execution incoherent pour ${sessionId}.`
    );
  }

  if (path.dirname(expectedDirectory) !== sessionsRootDirectory) {
    throw new Error(
      `Protection destruction: le dossier de ${sessionId} sort de terraform-sessions.`
    );
  }

  if (!fs.existsSync(sessionsRootDirectory)) {
    throw new Error(
      'Protection destruction: racine terraform-sessions introuvable.'
    );
  }

  if (!fs.existsSync(expectedDirectory)) {
    throw new Error(
      `Protection destruction: dossier Terraform introuvable pour ${sessionId}.`
    );
  }

  const directoryStats = fs.lstatSync(
    expectedDirectory
  );

  if (
    directoryStats.isSymbolicLink() ||
    !directoryStats.isDirectory()
  ) {
    throw new Error(
      `Protection destruction: dossier Terraform non fiable pour ${sessionId}.`
    );
  }

  const realRootDirectory = fs.realpathSync(
    sessionsRootDirectory
  );

  const realSessionDirectory = fs.realpathSync(
    expectedDirectory
  );

  const expectedRealDirectory = path.join(
    realRootDirectory,
    sessionId
  );

  if (realSessionDirectory !== expectedRealDirectory) {
    throw new Error(
      `Protection destruction: chemin reel inattendu pour ${sessionId}.`
    );
  }

  const statePath = path.join(
    realSessionDirectory,
    'terraform.tfstate'
  );

  if (!fs.existsSync(statePath)) {
    throw new Error(
      `Protection destruction: terraform.tfstate absent pour ${sessionId}.`
    );
  }

  const stateStats = fs.lstatSync(statePath);

  if (
    stateStats.isSymbolicLink() ||
    !stateStats.isFile() ||
    stateStats.size <= 0
  ) {
    throw new Error(
      `Protection destruction: terraform.tfstate invalide pour ${sessionId}.`
    );
  }

  return {
    sessionId,
    workingDirectory: realSessionDirectory,
    statePath,
  };
}

function readTerraformInstanceIdForDestroy(
  workingDirectory,
  sessionId
) {
  const output = terraformOutputRaw(
    'instance_id',
    workingDirectory
  );

  const outputError = output?.error
    ? String(output.error.message || output.error)
    : '';

  const stderr = String(output?.stderr || '').trim();

  if (
    outputError ||
    output?.status !== 0
  ) {
    const detail = (outputError || stderr || 'output Terraform indisponible')
      .replace(/\s+/g, ' ')
      .slice(0, 240);

    throw new Error(
      `Protection destruction: impossible de lire instance_id dans le state de ${sessionId} (${detail}).`
    );
  }

  const instanceId = String(
    output.stdout || ''
  ).trim();

  if (!instanceId) {
    throw new Error(
      `Protection destruction: instance_id vide dans le state de ${sessionId}.`
    );
  }

  return instanceId;
}

function validateDestroyTargetAgainstDatabase(
  databaseSession,
  explicitWorkingDirectory = null
) {
  const safeLocation =
    assertSafeTerraformStateLocation(
      databaseSession,
      explicitWorkingDirectory
    );

  const databaseInstanceId = String(
    databaseSession.instance_id || ''
  ).trim();

  if (!databaseInstanceId) {
    throw new Error(
      `Protection destruction: instance_id PostgreSQL absent pour ${safeLocation.sessionId}.`
    );
  }

  const stateInstanceId =
    readTerraformInstanceIdForDestroy(
      safeLocation.workingDirectory,
      safeLocation.sessionId
    );

  if (stateInstanceId !== databaseInstanceId) {
    throw new Error(
      `Protection destruction: instance_id incoherent pour ${safeLocation.sessionId}; destruction refusee.`
    );
  }

  pushLog(
    `Cible destruction validee: session=${safeLocation.sessionId}, ` +
      `dossier=${safeLocation.workingDirectory}, ` +
      `instance_db=${databaseInstanceId}, ` +
      `instance_state=${stateInstanceId}.`,
    'success'
  );

  return {
    ...safeLocation,
    databaseInstanceId,
    stateInstanceId,
  };
}

function validateFailedDeployCleanupTarget(
  databaseSession,
  explicitWorkingDirectory
) {
  const safeLocation =
    assertSafeTerraformStateLocation(
      databaseSession,
      explicitWorkingDirectory
    );

  const stateInstanceId =
    readTerraformInstanceIdForDestroy(
      safeLocation.workingDirectory,
      safeLocation.sessionId
    );

  const databaseInstanceId = String(
    databaseSession.instance_id || ''
  ).trim();

  if (
    databaseInstanceId &&
    databaseInstanceId !== stateInstanceId
  ) {
    throw new Error(
      `Protection nettoyage: instance_id incoherent pour ${safeLocation.sessionId}.`
    );
  }

  pushLog(
    `Cible nettoyage partiel validee: session=${safeLocation.sessionId}, ` +
      `dossier=${safeLocation.workingDirectory}, ` +
      `instance_state=${stateInstanceId}.`,
    'success'
  );

  return {
    ...safeLocation,
    databaseInstanceId: databaseInstanceId || null,
    stateInstanceId,
  };
}

/**
 * Copie les sources Terraform dans le dossier isolé d'une session.
 * Les états et caches d'une autre exécution ne sont jamais recopiés.
 */
function prepareSessionTerraformDirectory(sessionId) {
  const sessionDirectory =
    getSessionTerraformDirectory(sessionId);

  const sessionsRootDirectory = path.resolve(
    __dirname,
    'terraform-sessions'
  );

  const resolvedSessionDirectory =
    path.resolve(sessionDirectory);

  // Empêche toute sortie du dossier terraform-sessions.
  if (
    !resolvedSessionDirectory.startsWith(
      `${sessionsRootDirectory}${path.sep}`
    )
  ) {
    throw new Error(
      'Dossier Terraform de session invalide'
    );
  }

  // Ne jamais recopier un état ou un fichier propre
  // à une ancienne exécution Terraform.
  const excludedNames = new Set([
    '.terraform',
    'terraform.tfstate',
    'terraform.tfstate.backup',
    'terraform.tfvars',
    'crash.log',
  ]);

  fs.rmSync(
    resolvedSessionDirectory,
    {
      recursive: true,
      force: true,
    }
  );

  fs.mkdirSync(
    resolvedSessionDirectory,
    {
      recursive: true,
    }
  );

  function copyDirectory(
    sourceDirectory,
    targetDirectory
  ) {
    const entries = fs.readdirSync(
      sourceDirectory,
      {
        withFileTypes: true,
      }
    );

    for (const entry of entries) {
      if (
        excludedNames.has(entry.name) ||
        entry.name.startsWith('terraform.tfstate.') ||
        entry.name.endsWith('.tfplan')
      ) {
        continue;
      }

      const sourcePath = path.join(
        sourceDirectory,
        entry.name
      );

      const targetPath = path.join(
        targetDirectory,
        entry.name
      );

      if (entry.isDirectory()) {
        fs.mkdirSync(
          targetPath,
          {
            recursive: true,
          }
        );

        copyDirectory(
          sourcePath,
          targetPath
        );

        continue;
      }

      if (entry.isFile()) {
        fs.copyFileSync(
          sourcePath,
          targetPath
        );
      }
    }
  }

  copyDirectory(
    TERRAFORM_DIR,
    resolvedSessionDirectory
  );

  const statePath = path.join(
    resolvedSessionDirectory,
    'terraform.tfstate'
  );

  if (fs.existsSync(statePath)) {
    throw new Error(
      `Un terraform.tfstate existe deja dans ${resolvedSessionDirectory}`
    );
  }

  return resolvedSessionDirectory;
}

function runTerraform(
  argumentsList,
  extraEnvironment = {},
  workingDirectory = TERRAFORM_DIR
) {
  const operation = getCurrentOperation();

  return terraformService.runTerraform(
    argumentsList,
    {
      workingDirectory,
      extraEnvironment,
      onLog: (message, type = 'info') =>
        pushLog(message, type, operation),
    }
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOperationToLeaveRunning(
  operation,
  timeoutMs = 30000
) {
  if (!operation) return true;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (operation.status !== 'running') {
      return true;
    }
    await sleep(200);
  }

  return operation.status !== 'running';
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

function terraformOutputRaw(
  name,
  workingDirectory = TERRAFORM_DIR
) {
  return terraformService.outputRaw(
    name,
    {
      workingDirectory,
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

async function getOpenWebUiBaseUrl(sessionId) {
  const databaseSession =
    await sessionRepository.getSessionById(
      sessionId
    );

  if (!databaseSession?.access_url) {
    return null;
  }

  try {
    const url = new URL(databaseSession.access_url);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return null;
  }
}

function getProxyBaseUrl() {
  return config.proxyBaseUrl;
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

async function assertLocalAdminReady(sessionId) {
  const databaseSession =
    await sessionRepository.getSessionById(
      sessionId
    );

  if (
    !databaseSession ||
    databaseSession.status !== 'ready'
  ) {
    throw new Error(
      'La session OpenWebUI n est pas encore prete'
    );
  }

  const secrets =
    getSessionSecretsForId(sessionId, false);

  if (!secrets) {
    throw new Error(
      'Secrets OpenWebUI indisponibles pour cette session'
    );
  }

  if ((secrets.authMode || 'local_admin') !== 'local_admin') {
    throw new Error(
      'L ouverture automatique n est disponible qu en mode compte admin local'
    );
  }
}

async function signInToOpenWebUi(sessionId) {
  const openWebUiBaseUrl =
    await getOpenWebUiBaseUrl(sessionId);

  if (!openWebUiBaseUrl) {
    throw new Error(
      'URL OpenWebUI indisponible pour le login automatique'
    );
  }

  const secrets =
    getSessionSecretsForId(sessionId, false);

  if (
    !secrets?.adminEmail ||
    !secrets?.adminPassword
  ) {
    throw new Error(
      'Identifiants OpenWebUI indisponibles pour cette session'
    );
  }

  const response = await requestJson(
    `${openWebUiBaseUrl}/api/v1/auths/signin`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: secrets.adminEmail,
        password: secrets.adminPassword
      }),
      timeoutMs: 15000
    }
  );

  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    !response.body?.token
  ) {
    throw new Error(
      'Connexion automatique OpenWebUI impossible'
    );
  }

  secrets.jwt = response.body.token;
  secrets.jwtExpiresAt = response.body.expires_at
    ? new Date(
        response.body.expires_at * 1000
      ).toISOString()
    : new Date(
        Date.now() + 60 * 60 * 1000
      ).toISOString();

  persistState();
  return secrets.jwt;
}

async function ensureOpenWebUiJwt(sessionId) {
  const secrets =
    getSessionSecretsForId(sessionId, false);

  if (!secrets) {
    throw new Error(
      'Secrets OpenWebUI indisponibles pour cette session'
    );
  }

  if (secrets.jwt && secrets.jwtExpiresAt) {
    const expiresMs =
      new Date(secrets.jwtExpiresAt).getTime();

    if (
      Number.isFinite(expiresMs) &&
      expiresMs - Date.now() > 60 * 1000
    ) {
      return secrets.jwt;
    }
  }

  return signInToOpenWebUi(sessionId);
}

function rewriteProxyLocation(
  location,
  targetBaseUrl,
  req,
  sessionId
) {
  if (!location) return location;

  try {
    const targetBase = new URL(targetBaseUrl);
    const resolved = new URL(location, targetBase);

    if (resolved.origin !== targetBase.origin) {
      return location;
    }

    const proxyBase = new URL(getProxyBaseUrl(req));
    const sessionPrefix =
      `/session/${encodeURIComponent(sessionId)}`;

    return (
      `${proxyBase.origin}${sessionPrefix}` +
      `${resolved.pathname}${resolved.search}${resolved.hash}`
    );
  } catch (_) {
    return location;
  }
}

/**
 * Extrait l'identifiant de session depuis une URL.
 *
 * Format attendu :
 * /session/<sessionId>/...
 *
 * @param {string} requestUrl URL de la requête.
 * @returns {string|null}
 */
function getSessionIdFromRequestUrl(requestUrl) {
  if (
    typeof requestUrl !== 'string' ||
    requestUrl.trim() === ''
  ) {
    return null;
  }

  const pathname =
    requestUrl.split('?')[0];

  const match = pathname.match(
    /^\/session\/([^/]+)(?:\/|$)/
  );

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return null;
  }
}

function createProxyAccessError(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function resolveAuthorizedProxyContext(
  req,
  requestUrl
) {
  const cookieToken = getCookieValue(
    req,
    PROXY_COOKIE_NAME
  );

  const launchEntry = cookieToken
    ? launchTokens[cookieToken]
    : null;

  // Le cookie de lancement est la preuve d'acces utilisee par la
  // passerelle apres /launch/:token. Il a deja ete emis uniquement
  // apres authentification Privalyse + controle des droits en base.
  // On ne depend donc pas du cookie de login sur le port du proxy.
  if (
    !launchEntry ||
    !launchEntry.userId ||
    !launchEntry.tenantId ||
    !launchEntry.sessionId ||
    new Date(launchEntry.expiresAt).getTime() <= Date.now()
  ) {
    throw createProxyAccessError(
      'Ouverture automatique invalide. Reviens dans Prydena.',
      403
    );
  }

  const requestedSessionId =
    getSessionIdFromRequestUrl(requestUrl);

  const sessionId =
    requestedSessionId || launchEntry.sessionId;

  if (launchEntry.sessionId !== sessionId) {
    throw createProxyAccessError(
      'Ce lien d ouverture appartient a une autre session.',
      403
    );
  }

  const allowed =
    await sessionRepository.canUserAccessSession(
      sessionId,
      launchEntry.userId,
      launchEntry.tenantId
    );

  if (!allowed) {
    throw createProxyAccessError(
      'Acces refuse a cette session.',
      403
    );
  }

  const databaseSession =
    await sessionRepository.getSessionById(
      sessionId
    );

  if (
    !databaseSession ||
    !databaseSession.access_url ||
    databaseSession.status !== 'ready'
  ) {
    throw createProxyAccessError(
      'Session OpenWebUI indisponible.',
      503
    );
  }

  return {
    sessionId,
    launchEntry,
    databaseSession,
  };
}

function stripPrivalyseRoutingQuery(requestUrl) {
  try {
    const parsed = new URL(
      requestUrl || '/',
      'http://privalyse.local'
    );

    parsed.searchParams.delete(
      'privalyse_session'
    );

    return (
      `${parsed.pathname}${parsed.search}` ||
      '/'
    );
  } catch (_) {
    return requestUrl || '/';
  }
}

async function proxyRequestToOpenWebUi(
  req,
  res,
  jwt,
  proxyContext
) {
  const {
    sessionId,
    databaseSession,
  } = proxyContext;

  const targetBaseUrl =
    databaseSession.access_url;

  const requestHasSessionPrefix = Boolean(
    getSessionIdFromRequestUrl(
      req.originalUrl
    )
  );

  const proxyPath = requestHasSessionPrefix
    ? (
        req.originalUrl.replace(
          /^\/session\/[^/]+/,
          ''
        ) || '/'
      )
    : stripPrivalyseRoutingQuery(
        req.originalUrl
      );

  const targetUrl = new URL(
    proxyPath,
    targetBaseUrl
  );

  const client =
    targetUrl.protocol === 'https:'
      ? https
      : http;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];

  headers.authorization = `Bearer ${jwt}`;
  headers['accept-encoding'] = 'identity';
  headers.connection = 'keep-alive';
  headers.host = targetUrl.host;
  headers.origin = targetBaseUrl;
  headers['x-forwarded-host'] =
    req.headers.host || '';
  headers['x-forwarded-proto'] =
    req.headers['x-forwarded-proto'] ||
    (req.socket.encrypted ? 'https' : 'http');

  const forwardCookies =
    buildForwardCookieHeader(req);

  if (forwardCookies) {
    headers.cookie = forwardCookies;
  } else {
    delete headers.cookie;
  }

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const responseHeaders = {
        ...proxyRes.headers,
      };

      delete responseHeaders['content-encoding'];
      delete responseHeaders['content-length'];

      if (
        responseHeaders.location &&
        requestHasSessionPrefix
      ) {
        responseHeaders.location =
          rewriteProxyLocation(
            responseHeaders.location,
            targetBaseUrl,
            req,
            sessionId
          );
      }

      res.writeHead(
        proxyRes.statusCode || 502,
        responseHeaders
      );

      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    if (!res.headersSent) {
      res
        .status(502)
        .send(
          `Proxy OpenWebUI indisponible: ${error.message}`
        );
      return;
    }

    res.destroy(error);
  });

  req.pipe(proxyReq);
}

function destroySocketQuietly(targetSocket) {
  if (
    targetSocket &&
    !targetSocket.destroyed
  ) {
    try {
      targetSocket.destroy();
    } catch (_) {
      // Rien a faire : la socket est deja en cours de fermeture.
    }
  }
}

async function proxyUpgradeToOpenWebUi(
  req,
  socket,
  head
) {
  // Un navigateur peut fermer/recharger une connexion WebSocket
  // pendant le handshake. ECONNRESET est alors normal et ne doit
  // jamais faire tomber tout le backend Node.
  socket.on('error', () => {
    destroySocketQuietly(socket);
  });

  let proxyContext;

  try {
    proxyContext =
      await resolveAuthorizedProxyContext(
        req,
        req.url
      );
  } catch (_) {
    socket.destroy();
    return;
  }

  let sessionJwt;

  try {
    sessionJwt =
      await ensureOpenWebUiJwt(
        proxyContext.sessionId
      );
  } catch (_) {
    socket.destroy();
    return;
  }

  const targetBaseUrl =
    proxyContext.databaseSession.access_url;

  const requestHasSessionPrefix = Boolean(
    getSessionIdFromRequestUrl(req.url)
  );

  const proxyPath = requestHasSessionPrefix
    ? (
        req.url.replace(
          /^\/session\/[^/]+/,
          ''
        ) || '/'
      )
    : stripPrivalyseRoutingQuery(
        req.url
      );

  const targetUrl = new URL(
    proxyPath,
    targetBaseUrl
  );

  const client =
    targetUrl.protocol === 'https:'
      ? https
      : http;

  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  headers.origin = targetBaseUrl;
  headers.authorization =
    `Bearer ${sessionJwt}`;
  headers['x-forwarded-host'] =
    req.headers.host || '';
  headers['x-forwarded-proto'] =
    req.headers['x-forwarded-proto'] ||
    (req.socket.encrypted ? 'https' : 'http');

  const proxyReq = client.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port:
      targetUrl.port ||
      (targetUrl.protocol === 'https:'
        ? 443
        : 80),
    path:
      `${targetUrl.pathname}${targetUrl.search}`,
    method: req.method,
    headers,
  });

  proxyReq.on(
    'upgrade',
    (proxyRes, proxySocket, proxyHead) => {
      const closeBothSockets = () => {
        destroySocketQuietly(proxySocket);
        destroySocketQuietly(socket);
      };

      // ECONNRESET / EPIPE sont frequents lors d'un refresh,
      // d'une fermeture d'onglet ou d'une reconnexion WebSocket.
      // Ils restent locaux a cette connexion.
      proxySocket.on(
        'error',
        closeBothSockets
      );

      socket.on(
        'close',
        () => destroySocketQuietly(proxySocket)
      );

      proxySocket.on(
        'close',
        () => destroySocketQuietly(socket)
      );

      try {
        socket.write(
          `HTTP/${req.httpVersion} ` +
          `${proxyRes.statusCode} ` +
          `${proxyRes.statusMessage}\r\n` +
          Object.entries(proxyRes.headers)
            .map(([key, value]) =>
              `${key}: ${
                Array.isArray(value)
                  ? value.join('; ')
                  : value
              }`
            )
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
      } catch (_) {
        closeBothSockets();
      }
    }
  );

  proxyReq.on('error', () => {
    destroySocketQuietly(socket);
  });

  // Si la cible refuse l'upgrade WebSocket avec une reponse HTTP,
  // on ferme proprement au lieu de garder une socket orpheline.
  proxyReq.on('response', (proxyRes) => {
    proxyRes.resume();
    destroySocketQuietly(socket);
  });

  proxyReq.end();
}

function getReadinessBudget() {
  return {
    maxAttempts: 180,
    delayMs: 5000,
  };
}

async function waitForIaReady(
  ip,
  expectedModel = null
) {
  const operation = getCurrentOperation();

  const openWebUiUrl =
    `http://${ip}:3000/`;

  const {
    maxAttempts,
    delayMs,
  } = getReadinessBudget();

  const totalMinutes = Math.round(
    (maxAttempts * delayMs) / 60000
  );

  pushLog(
    `Attente du workspace CPU Privalyse sur ${openWebUiUrl} ` +
    `(fenetre maximale ~${totalMinutes} min, ` +
    `modele=${expectedModel || 'n/a'})`,
    'info'
  );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    if (operation?.cancelReadiness) {
      pushLog(
        'Attente readiness interrompue a la demande utilisateur',
        'info'
      );

      return {
        ready: false,
        cancelled: true,
      };
    }

    try {
      await checkHttpStatus(
        openWebUiUrl,
        [200, 301, 302, 307, 308]
      );

      pushLog(
        `Workspace Privalyse pret sur ${openWebUiUrl}`,
        'ia-ready'
      );

      return {
        ready: true,
        url: openWebUiUrl,
        cancelled: false,
      };
    } catch (_) {
      // Premier essai puis environ toutes les 30 secondes.
      if (
        attempt === 1 ||
        attempt % 6 === 0
      ) {
        const elapsedSeconds =
          Math.round(
            (attempt * delayMs) / 1000
          );

        pushLog(
          `Workspace CPU pas encore pret ` +
          `(tentative ${attempt}/${maxAttempts}, ` +
          `~${elapsedSeconds}s ecoulees)`,
          'info'
        );
      }

      const sliceMs = 500;

      for (
        let waited = 0;
        waited < delayMs;
        waited += sliceMs
      ) {
        if (
          operation?.cancelReadiness
        ) {
          pushLog(
            'Attente readiness interrompue a la demande utilisateur',
            'info'
          );

          return {
            ready: false,
            cancelled: true,
          };
        }

        await sleep(
          Math.min(
            sliceMs,
            delayMs - waited
          )
        );
      }
    }
  }

  pushLog(
    `Workspace Prydena indisponible apres environ ${totalMinutes} minutes`,
    'error'
  );

  return {
    ready: false,
    cancelled: false,
  };
}

app.post(
'/api/deploy',

authMiddleware.authenticate,
authMiddleware.requireAuthentication,
requireAdminToken,
validationMiddleware.validateDeployment,

async (req, res) => {
const {
workspaceName,
sessionTtlHours,
sessionMode,
groupId
} = req.body;


const aiChoice =
  DEFAULT_DEPLOYMENT_CONFIG.aiChoice;

const instanceType =
  sessionMode === 'team'
    ? DEFAULT_DEPLOYMENT_CONFIG.teamInstanceType
    : DEFAULT_DEPLOYMENT_CONFIG.individualInstanceType;

const allowedCidr =
  DEFAULT_DEPLOYMENT_CONFIG.allowedCidr;

const authMode =
  DEFAULT_DEPLOYMENT_CONFIG.authMode;

const workspaceUrl =
  DEFAULT_DEPLOYMENT_CONFIG.workspaceUrl;

const trustedEmailHeader =
  DEFAULT_DEPLOYMENT_CONFIG.trustedEmailHeader;

const trustedNameHeader =
  DEFAULT_DEPLOYMENT_CONFIG.trustedNameHeader;

const trustedGroupsHeader =
  DEFAULT_DEPLOYMENT_CONFIG.trustedGroupsHeader;

const trustedRoleHeader =
  DEFAULT_DEPLOYMENT_CONFIG.trustedRoleHeader;

const owuiName =
  DEFAULT_DEPLOYMENT_CONFIG.owuiName;

const owuiEmail =
  DEFAULT_DEPLOYMENT_CONFIG.owuiEmail;

// Mot de passe généré automatiquement.
// Il ne sera jamais demandé à l'utilisateur.
const owuiPassword =
  crypto.randomBytes(24).toString('base64url');

const teamSizeHint =
  sessionMode === 'team' ? 3 : 1;

const existingDeployOperation =
  getRunningDeployForUser(req.auth.userId);

if (existingDeployOperation) {
  return res.status(409).json({
    ok: false,
    error:
      'Un deploiement est deja en cours pour votre compte'
  });
}

const deployOperation = createOperation({
  type: 'deploy',
  userId: req.auth.userId,
  tenantId: req.auth.tenantId,
});

pendingDeployOperationsByUser.set(
  req.auth.userId,
  deployOperation
);

return operationContext.run(
  deployOperation,
  async () => {
    try {
      /*
       * Un compte ne peut posseder qu'une seule session non detruite.
       * Les sessions partagees creees par d'autres utilisateurs restent
       * accessibles et ne bloquent pas la creation d'une session personnelle.
       *
       * Ce controle est fait cote serveur : il reste donc actif meme si
       * l'interface est contournee ou si deux onglets sont ouverts.
       */
      const existingSessions =
        await sessionRepository.listSessionsForUser(
          req.auth.userId,
          req.auth.tenantId,
          false
        );

      const ownedActiveSession =
        existingSessions.find(
          (item) =>
            item.created_by_user_id === req.auth.userId
        ) || null;

      if (ownedActiveSession) {
        return res.status(409).json({
          ok: false,
          code: 'ACTIVE_SESSION_EXISTS',
          sessionId: ownedActiveSession.id,
          error:
            'Une session est deja active pour votre compte. Detruisez-la avant d en creer une nouvelle.'
        });
      }

      let groupMembers = [];
      let selectedGroup = null;

if (sessionMode === 'team') {
  selectedGroup =
    await groupRepository.findGroupById(
      groupId,
      req.auth.tenantId
    );

  if (!selectedGroup) {
    return res.status(400).json({
      ok: false,
      error:
        'Le groupe sélectionné est introuvable.'
    });
  }

  groupMembers =
    await groupRepository.listGroupMembers(
      selectedGroup.id,
      req.auth.tenantId
    );

  if (groupMembers.length === 0) {
    return res.status(400).json({
      ok: false,
      error:
        'Le groupe ne contient aucun membre.'
    });
  }

  if (groupMembers.length > 3) {
    return res.status(400).json({
      ok: false,
      error:
        'Un groupe ne peut pas dépasser 3 membres.'
    });
  }
}

if (!AI_PULL_MAP[aiChoice]) {
  return res.status(400).json({
    ok: false,
    error: 'aiChoice invalide'
  });
}

if (!INSTANCE_TYPES.has(instanceType)) {
  return res.status(400).json({
    ok: false,
    error: 'instanceType invalide'
  });
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

if (
  !Number.isInteger(finalSessionTtlHours) ||
  ![1, 2, 3].includes(finalSessionTtlHours)
) {
  return res.status(400).json({
    ok: false,
    error: 'sessionTtlHours doit être égal à 1, 2 ou 3.'
  });
}
const quotaStatus =
  await usageRepository.getMonthlyQuotaStatus({
    tenantId: req.auth.tenantId,
    userId: req.auth.userId,
    sessionMode,
    groupId:
      sessionMode === 'team'
        ? selectedGroup.id
        : null,
    requestedHours: finalSessionTtlHours,
  });

if (!quotaStatus.allowed) {
  return res.status(403).json({
    ok: false,
    code: 'MONTHLY_QUOTA_EXCEEDED',
    error:
      `Quota mensuel insuffisant. ` +
      `Il reste ${quotaStatus.remainingHours.toFixed(2)} h, ` +
      `mais la session demande ${finalSessionTtlHours} h.`,
    quota: quotaStatus,
  });
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
  const finalWorkspaceSlug =
  `${slugifyWorkspaceName(finalWorkspaceName)}-${crypto.randomUUID().slice(0, 8)}`;
  const finalWorkspaceUrl = typeof workspaceUrl === 'string' ? workspaceUrl.trim() : '';
  const finalAuthMode = authMode;
  const finalOwuiPassword =
    finalAuthMode === 'trusted_header'
      ? crypto.randomBytes(18).toString('base64url')
      : owuiPassword;
  const finalWebuiSecretKey = crypto.randomBytes(48).toString('hex');
  const expectedModel = AI_PULL_MAP[aiChoice] || null;
  const accessNotes = buildAccessNotes(
    finalAuthMode,
    finalWorkspaceUrl,
    finalOwuiEmail
  );

  // Garde-fou pendant le provisioning : si le backend redémarre ou si la
  // préparation reste bloquée, la boucle de nettoyage conserve une échéance.
  // Cette date sera remplacée au premier passage à ready par ready_at + TTL.
  const provisioningSafetyExpiresAt = new Date(
    Date.now() +
      finalSessionTtlHours *
        60 *
        60 *
        1000
  ).toISOString();

  let databaseSession = null;
  let sessionTerraformDirectory = null;

  try {
    deployOperation.type = 'deploy';
    deployOperation.status = 'running';
    deployOperation.phase = 'terraform';
    deployOperation.cancelReadiness = false;
    deployOperation.logs = [];

    try {
      databaseSession =
        await sessionRepository.createSession({
          tenantId: req.auth.tenantId,
          createdByUserId: req.auth.userId,
          name: finalWorkspaceName,
          slug: finalWorkspaceSlug,
          status: 'provisioning',
          terraformDirectory: null,
          expiresAt: provisioningSafetyExpiresAt,
          sessionTtlHours: finalSessionTtlHours,
          sessionMode,
          groupId:
            sessionMode === 'team'
              ? groupId.trim()
              : null,
        });
    } catch (createSessionError) {
      /*
       * Dernière barrière contre une double création : la migration 009
       * impose aussi l'unicité directement dans PostgreSQL. Ce cas peut
       * arriver si deux requêtes concurrentes atteignent deux processus
       * Node différents avant que le contrôle applicatif ne voie la session.
       */
      if (
        createSessionError?.code === '23505' &&
        createSessionError?.constraint ===
          'sessions_one_active_per_creator_unique'
      ) {
        return res.status(409).json({
          ok: false,
          code: 'ACTIVE_SESSION_EXISTS',
          error:
            'Une session est deja active pour votre compte. Detruisez-la avant d en creer une nouvelle.'
        });
      }

      throw createSessionError;
    }

    await usageRepository.setBillingOwnerSnapshot(
      databaseSession.id,
      sessionMode === 'team'
        ? {
            type: 'group',
            id: selectedGroup.id,
            name: selectedGroup.name,
          }
        : {
            type: 'user',
            id: req.auth.userId,
            name: req.auth.email,
          }
    );

    await sessionRepository.addUserToSession(
      databaseSession.id,
      req.auth.userId
    );

    bindOperationToSession(
      deployOperation,
      databaseSession.id
    );
   if (sessionMode === 'team') {
  for (const member of groupMembers) {
    await sessionRepository.addUserToSession(
      databaseSession.id,
      member.id
    );
  }
}

    pushLog(
  sessionMode === 'team'
    ? `${groupMembers.length} membre(s) du groupe autorise(s) sur la session : ${databaseSession.id}`
    : `Utilisateur createur autorise sur la session : ${databaseSession.id}`,
  'info'
);



    pushLog(
      `Session PostgreSQL creee : ${databaseSession.id}`,
      'info'
    );

    sessionTerraformDirectory =
    prepareSessionTerraformDirectory(
    databaseSession.id
  );

    pushLog(
      `Dossier Terraform isole prepare : ${sessionTerraformDirectory}`,
      'info'
    );
    databaseSession =
  await sessionRepository.updateSessionInfrastructure(
    databaseSession.id,
    {
      instanceId: null,
      publicIp: null,
      dnsName: null,
      accessUrl: null,
      terraformDirectory:
        sessionTerraformDirectory,
    }
  );

if (!databaseSession) {
  throw new Error(
    'Impossible d enregistrer le dossier Terraform de la session.'
  );
}

pushLog(
  `Dossier Terraform enregistre en PostgreSQL : ${sessionTerraformDirectory}`,
  'success'
);

    sessionState.databaseSessionId = databaseSession.id;
    draftSessionState.databaseSessionId = databaseSession.id;
    persistState();

    const sessionModeLabel =
  sessionMode === 'team'
    ? 'equipe'
    : 'individuelle';

pushLog(
  `Nouvelle session ${sessionModeLabel} (${finalWorkspaceName}, auth_mode=${finalAuthMode}, instance=${finalInstanceType}, ttl=${finalSessionTtlHours}h)`,
  'info'
);
    pushLog(`Compte bootstrap OpenWebUI: ${maskEmail(finalOwuiEmail)}`, 'info');
    pushLog(`CIDR autorise: ${finalAllowedCidr}`, 'info');
    if (expectedModel) {
      pushLog(`Modele attendu cote Ollama: ${expectedModel}`, 'info');
    }

    const tfvarsPath = path.join(
      sessionTerraformDirectory,
      'terraform.tfvars'
    );
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
    draftSessionState.sessionMode = sessionMode;

      draftSessionState.groupId =
      sessionMode === 'team'
        ? groupId.trim()
        : null;
    draftSessionState.createdAt = new Date().toISOString();
    // Le TTL utilisateur ne démarre qu'au premier passage à ready.
    // La DB conserve un expires_at de sécurité pendant le provisioning,
    // mais il n'est pas présenté comme temps d'utilisation.
    draftSessionState.expiresAt = null;
    persistState();

    pushLog(
      `terraform.tfvars mis a jour (workspace=${finalWorkspaceSlug}, instance=${finalInstanceType})`,
      'info'
    );

    await runTerraform(
      ['init', '-input=false'],
      {},
      sessionTerraformDirectory
    );

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
    }, sessionTerraformDirectory);

    await usageRepository.markMachineStarted(
      databaseSession.id,
      finalInstanceType
    );

    pushLog(
      `Compteur de consommation machine demarre pour la session ${databaseSession.id}.`,
      'info'
    );

    const ipOutput = terraformOutputRaw(
      'instance_public_ip',
      sessionTerraformDirectory
    );

    const instanceIdOutput = terraformOutputRaw(
      'instance_id',
      sessionTerraformDirectory
    );

    const accessUrlOutput = terraformOutputRaw(
      'workspace_access_url',
      sessionTerraformDirectory
    );

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
        pushLog(`Instance OpenStack : ${instanceId}`,'info');
      }
      pushLog(`URL de session : ${accessUrl}`, 'success');

            await sessionRepository.updateSessionInfrastructure(
        databaseSession.id,
        {
          instanceId,
          publicIp: ip,
          dnsName: null,
          accessUrl,
          terraformDirectory:
            sessionTerraformDirectory,
        }
      );

      pushLog(
        'Infrastructure Infomaniak/OpenStack enregistrée en PostgreSQL.',
        'success'
      );

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
      sessionState.sessionMode = sessionMode;
sessionState.groupId =
  sessionMode === 'team'
    ? groupId.trim()
    : null;
      sessionState.createdAt = new Date().toISOString();
      sessionState.expiresAt = null;
      const sessionSecrets =
        getSessionSecretsForId(
          databaseSession.id,
          true
        );

      sessionSecrets.adminEmail = finalOwuiEmail;
      sessionSecrets.adminPassword = finalOwuiPassword;
      sessionSecrets.authMode = finalAuthMode;
      sessionSecrets.jwt = null;
      sessionSecrets.jwtExpiresAt = null;
      deleteLaunchTokensForSession(databaseSession.id);
      persistState();

    deployOperation.phase = 'readiness';

const readiness =
  await waitForIaReady(
    ip,
    expectedModel
  );

if (readiness.cancelled) {
  deployOperation.type = 'idle';
  deployOperation.status = 'idle';
  deployOperation.phase = 'idle';
  deployOperation.cancelReadiness = false;

  pushLog(
    'Deploy interrompu pendant la readiness pour permettre une destruction',
    'info'
  );

  return res.status(409).json({
    ok: false,
    error:
      'Deploy interrompu pour permettre la destruction',
  });
}

if (!readiness.ready) {
  sessionState.status = 'error';
  draftSessionState.status = 'error';

  persistState();

  throw new Error(
    'Le workspace a ete provisionne mais OpenWebUI ne repond pas dans le delai imparti.'
  );
}

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

} else {
  throw new Error(
    'Impossible de recuperer instance_public_ip'
  );
}
    if (databaseSession) {
      databaseSession = await usageRepository.markReady(
        databaseSession.id
      );

      if (!databaseSession || !databaseSession.expires_at) {
        throw new Error(
          'Session prête mais expiration TTL impossible à calculer.'
        );
      }

      sessionState.status = 'ready';
      draftSessionState.status = 'ready';
      sessionState.expiresAt = databaseSession.expires_at;
      draftSessionState.expiresAt = databaseSession.expires_at;
      persistState();

      pushLog(
        `TTL utilisateur démarré à ready : ${finalSessionTtlHours}h, expiration ${new Date(databaseSession.expires_at).toISOString()}.`,
        'success'
      );

      scheduleDestroyFromTtl(
        databaseSession.id,
        databaseSession.expires_at
      );
    }

    deployOperation.status = 'success';
    deployOperation.phase = 'idle';
    deployOperation.cancelReadiness = false;
    deployOperation.type = 'idle';

    return res.json({
      ok: true,
      sessionId: databaseSession.id
    });
  } catch (e) {
  const message = String(
    e && e.message ? e.message : e
  );

  deployOperation.status = 'error';
  deployOperation.phase = 'cleanup';
  deployOperation.cancelReadiness = false;

  pushLog(
    `Erreur deploy: ${message}`,
    'error'
  );

  /*
   * Si le dossier Terraform de la session existe déjà,
   * un apply a potentiellement créé une partie de
   * l'infrastructure.
   *
   * On tente donc toujours un destroy avec le même state.
   */
  if (sessionTerraformDirectory) {
    pushLog(
      'Tentative de nettoyage automatique de l infrastructure partiellement provisionnee...',
      'info'
    );

    try {
      if (!databaseSession) {
        throw new Error(
          'Protection nettoyage: session PostgreSQL introuvable.'
        );
      }

      await withSerializedDestroy(
        databaseSession.id,
        async () => {
          const cleanupTarget =
            validateFailedDeployCleanupTarget(
              databaseSession,
              sessionTerraformDirectory
            );

          await runTerraform(
            [
              'destroy',
              '-auto-approve',
            ],
            {
              TF_VAR_allowed_cidr:
                config.workspace.allowedCidr ||
                '127.0.0.1/32',

              TF_VAR_webui_secret_key:
                crypto.randomBytes(48).toString('hex'),

              TF_VAR_owui_password:
                crypto.randomBytes(24).toString('base64url'),
            },
            cleanupTarget.workingDirectory
          );

          const destroyedSession =
            await sessionRepository.markSessionDestroyed(
              databaseSession.id
            );

          if (!destroyedSession) {
            throw new Error(
              'Infrastructure partielle detruite mais mise a jour PostgreSQL impossible.'
            );
          }
        }
      );

      pushLog(
        'Infrastructure partielle detruite automatiquement.',
        'success'
      );

      clearSessionSecrets(databaseSession.id);

      if (
        sessionState.databaseSessionId ===
          databaseSession.id
      ) {
        clearSessionLikeState(
          sessionState
        );

        clearSessionLikeState(
          draftSessionState
        );
      }

      persistState();
    } catch (cleanupError) {
      pushLog(
        `Echec du nettoyage automatique: ${cleanupError.message}`,
        'error'
      );

      /*
       * On ne masque surtout pas l'erreur initiale.
       * La session reste en erreur pour permettre
       * une intervention/destruction manuelle.
       */
      if (databaseSession) {
        try {
          await sessionRepository.updateSessionStatus(
            databaseSession.id,
            'error'
          );
        } catch (statusError) {
          pushLog(
            `Impossible de marquer la session en erreur: ${statusError.message}`,
            'error'
          );
        }
      }
    }
  }

  deployOperation.status = 'error';
  deployOperation.phase = 'idle';
  deployOperation.cancelReadiness = false;

  if (
    /quota|limit exceeded|overlimit|flavor/i.test(
      message
    )
  ) {
    const quotaHelp =
      'Quota Infomaniak Public Cloud insuffisant ou flavor CPU indisponible dans la region choisie.';

    pushLog(
      quotaHelp,
      'error'
    );

    return res.status(409).json({
      ok: false,
      error: quotaHelp,
    });
  }

return res.status(500).json({
  ok: false,
  error: message,
});
  }
    } finally {
      if (
        pendingDeployOperationsByUser.get(
          req.auth.userId
        ) === deployOperation
      ) {
        pendingDeployOperationsByUser.delete(
          req.auth.userId
        );
      }
    }
  }
);
});

app.post(
  '/api/destroy',

  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  requireExplicitDestroySessionAccess,

  async (req, res) => {
    const sessionId = req.sessionId;

    const runningOperation =
      getRunningOperationForSession(sessionId);

    if (runningOperation) {
      const canInterruptReadiness =
        runningOperation.type === 'deploy' &&
        runningOperation.phase === 'readiness';

      if (canInterruptReadiness) {
        pushLog(
          'Destruction demandee pendant les tentatives readiness, interruption en cours...',
          'info',
          runningOperation
        );

        runningOperation.cancelReadiness = true;

        const released =
          await waitForOperationToLeaveRunning(
            runningOperation,
            30000
          );

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
          error:
            `Operation ${runningOperation.type} deja en cours sur cette session`
        });
      }
    }

    const destroyOperation = createOperation({
      type: 'destroy',
      sessionId,
      userId: req.auth.userId,
      tenantId: req.auth.tenantId,
    });

    bindOperationToSession(
      destroyOperation,
      sessionId
    );

    return operationContext.run(
      destroyOperation,
      async () => {
        try {
          await destroySessionInternal(
            sessionId,
            'manual'
          );

          return res.json({
            ok: true,
            sessionId
          });
        } catch (error) {
          destroyOperation.status = 'error';
          destroyOperation.phase = 'idle';
          destroyOperation.cancelReadiness = false;

          pushLog(
            `Erreur destroy: ${error.message}`,
            'error'
          );

          const statusCode =
            error.message === 'Session introuvable.'
              ? 404
              : error.message ===
                  'Cette session est deja detruite.'
                ? 409
                : 500;

          return res.status(statusCode).json({
            ok: false,
            error: error.message
          });
        }
      }
    );
  }
);


/**
 * Validation légère des identifiants UUID reçus dans les routes groupes.
 */
function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Liste les groupes accessibles dans l'organisation courante.
 * Cette route est utilisée par la page de création d'une session d'équipe.
 */
app.get(
  '/api/groups',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  async (req, res) => {
    try {
     const groups =
     await groupRepository.listGroupsByUserId(
    req.auth.tenantId,
    req.auth.userId
  );
      return res.json({
        ok: true,
        count: groups.length,
        groups,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: `Impossible de charger les groupes : ${error.message}`,
      });
    }
  }
);
/**
 * Retourne la consommation mensuelle et le quota
 * pour l'utilisateur ou le groupe sélectionné.
 */
app.get(
  '/api/usage/quota',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  async (req, res) => {
    try {
      const sessionMode =
        req.query?.mode === 'team'
          ? 'team'
          : 'individual';

      let groupId = null;

      if (sessionMode === 'team') {
        groupId = req.query?.groupId || null;

        if (!groupId || !isUuid(groupId)) {
          return res.status(400).json({
            ok: false,
            error: 'Groupe invalide.',
          });
        }

        const groups =
          await groupRepository.listGroupsByUserId(
            req.auth.tenantId,
            req.auth.userId
          );

        const allowedGroup = groups.find(
          (group) => group.id === groupId
        );

        if (!allowedGroup) {
          return res.status(403).json({
            ok: false,
            error:
              'Vous ne pouvez pas consulter le quota de ce groupe.',
          });
        }
      }

      const quota =
        await usageRepository.getMonthlyQuotaStatus({
          tenantId: req.auth.tenantId,
          userId: req.auth.userId,
          sessionMode,
          groupId,
          requestedHours: 0,
        });

      return res.json({
        ok: true,
        quota,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          `Impossible de charger la consommation : ${error.message}`,
      });
    }
  }
);
/**
 * Liste tous les groupes du tenant pour l'administration.
 */
app.get(
  '/api/admin/groups',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const groups = await groupRepository.listGroupsByTenantId(
        req.auth.tenantId
      );

      return res.json({
        ok: true,
        count: groups.length,
        groups,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: `Impossible de charger les groupes : ${error.message}`,
      });
    }
  }
);

/**
 * Crée un groupe dans le tenant de l'administrateur connecté.
 */
app.post(
  '/api/admin/groups',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string'
        ? req.body.name.trim()
        : '';

      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({
          ok: false,
          error: 'Le nom du groupe doit contenir entre 2 et 100 caractères.',
        });
      }

      const existingGroups = await groupRepository.listGroupsByTenantId(
        req.auth.tenantId
      );

      const duplicate = existingGroups.some(
        (group) => group.name.trim().toLowerCase() === name.toLowerCase()
      );

      if (duplicate) {
        return res.status(409).json({
          ok: false,
          error: 'Un groupe portant ce nom existe déjà.',
        });
      }

      const group = await groupRepository.createGroup({
        tenantId: req.auth.tenantId,
        name,
        createdBy: req.auth.userId,
      });

      if (!group) {
        return res.status(400).json({
          ok: false,
          error: 'Impossible de créer le groupe.',
        });
      }

      return res.status(201).json({
        ok: true,
        message: 'Groupe créé avec succès.',
        group: {
          ...group,
          members: [],
        },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: `Impossible de créer le groupe : ${error.message}`,
      });
    }
  }
);

/**
 * Ajoute un utilisateur au groupe, avec une limite MVP de trois membres.
 */
app.post(
  '/api/admin/groups/:groupId/members',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const userId = req.body?.userId;

      if (!isUuid(groupId) || !isUuid(userId)) {
        return res.status(400).json({
          ok: false,
          error: 'Identifiant de groupe ou d’utilisateur invalide.',
        });
      }

      const group = await groupRepository.findGroupById(
        groupId,
        req.auth.tenantId
      );

      if (!group) {
        return res.status(404).json({
          ok: false,
          error: 'Groupe introuvable.',
        });
      }

      const members = await groupRepository.listGroupMembers(
        groupId,
        req.auth.tenantId
      );

      if (members.some((member) => member.id === userId)) {
        return res.status(409).json({
          ok: false,
          error: 'Cet utilisateur appartient déjà au groupe.',
        });
      }

      if (members.length >= 3) {
        return res.status(409).json({
          ok: false,
          error: 'Un groupe ne peut pas contenir plus de 3 membres.',
        });
      }

      const membership = await groupRepository.addGroupMember({
        groupId,
        userId,
        tenantId: req.auth.tenantId,
      });

      if (!membership) {
        return res.status(400).json({
          ok: false,
          error: 'Utilisateur introuvable dans cette organisation.',
        });
      }

      return res.status(201).json({
        ok: true,
        message: 'Membre ajouté au groupe.',
        membership,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: `Impossible d’ajouter le membre : ${error.message}`,
      });
    }
  }
);

/**
 * Retire un utilisateur d'un groupe.
 */
app.delete(
  '/api/admin/groups/:groupId/members/:userId',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const { groupId, userId } = req.params;

      if (!isUuid(groupId) || !isUuid(userId)) {
        return res.status(400).json({
          ok: false,
          error: 'Identifiant de groupe ou d’utilisateur invalide.',
        });
      }

      const removed = await groupRepository.removeGroupMember({
        groupId,
        userId,
        tenantId: req.auth.tenantId,
      });

      if (!removed) {
        return res.status(404).json({
          ok: false,
          error: 'Membre ou groupe introuvable.',
        });
      }

      return res.json({
        ok: true,
        message: 'Membre retiré du groupe.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: `Impossible de retirer le membre : ${error.message}`,
      });
    }
  }
);
/**
 * Modifie le quota mensuel d'un groupe.
 * null = illimité.
 */
app.patch(
  '/api/admin/groups/:groupId/quota',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      if (!isUuid(groupId)) {
        return res.status(400).json({
          ok: false,
          error: 'Identifiant de groupe invalide.',
        });
      }

      const rawMonthlyQuotaHours =
        req.body?.monthlyQuotaHours;

      let monthlyQuotaHours = null;

      if (
        rawMonthlyQuotaHours !== null &&
        rawMonthlyQuotaHours !== undefined &&
        rawMonthlyQuotaHours !== ''
      ) {
        const parsedQuota =
          Number(rawMonthlyQuotaHours);

        if (
          !Number.isInteger(parsedQuota) ||
          parsedQuota < 0 ||
          parsedQuota > 744
        ) {
          return res.status(400).json({
            ok: false,
            error:
              'Le quota mensuel doit être un entier entre 0 et 744 heures.',
          });
        }

        monthlyQuotaHours = parsedQuota;
      }

      const group =
        await groupRepository.updateMonthlyQuotaByIdAndTenantId({
          groupId,
          tenantId: req.auth.tenantId,
          monthlyQuotaHours,
        });

      if (!group) {
        return res.status(404).json({
          ok: false,
          error: 'Groupe introuvable.',
        });
      }

      return res.json({
        ok: true,
        group: {
          id: group.id,
          name: group.name,
          monthlyQuotaHours:
            group.monthly_quota_hours === null
              ? null
              : Number(group.monthly_quota_hours),
        },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          `Impossible de modifier le quota du groupe : ${error.message}`,
      });
    }
  }
);
/**
 * Supprime un groupe et ses appartenances.
 */
app.delete(
  '/api/admin/groups/:groupId',
  authMiddleware.authenticate,
  authMiddleware.requireAuthentication,
  authMiddleware.requireRole('owner', 'admin'),
  async (req, res) => {
    try {
      const { groupId } = req.params;

      if (!isUuid(groupId)) {
        return res.status(400).json({
          ok: false,
          error: 'Identifiant de groupe invalide.',
        });
      }

      const deleted = await groupRepository.deleteGroupByIdAndTenantId({
        groupId,
        tenantId: req.auth.tenantId,
      });

      if (!deleted) {
        return res.status(404).json({
          ok: false,
          error: 'Groupe introuvable.',
        });
      }

      return res.json({
        ok: true,
        message: 'Groupe supprimé avec succès.',
        group: deleted,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: `Impossible de supprimer le groupe : ${error.message}`,
      });
    }
  }
);

restorePersistedSession();

proxyApp.get(
  '/launch/:token',
  authMiddleware.requireAuthentication,
  async (req, res) => {
    try {
      const launchEntry =
        launchTokens[req.params.token];

      if (
        !launchEntry ||
        !launchEntry.sessionId ||
        launchEntry.userId !== req.auth.userId ||
        (launchEntry.tenantId &&
          launchEntry.tenantId !== req.auth.tenantId) ||
        new Date(
          launchEntry.expiresAt
        ).getTime() <= Date.now()
      ) {
        return res
          .status(403)
          .send(
            'Lien d ouverture expire ou invalide'
          );
      }

      // Complete les anciens tokens crees avant l'ajout de tenantId.
      if (!launchEntry.tenantId) {
        launchEntry.tenantId = req.auth.tenantId;
        persistState();
      }

      const allowed =
        await sessionRepository.canUserAccessSession(
          launchEntry.sessionId,
          req.auth.userId,
          req.auth.tenantId
        );

      if (!allowed) {
        return res
          .status(403)
          .send(
            'Acces refuse a cette session'
          );
      }

      const databaseSession =
        await sessionRepository.getSessionById(
          launchEntry.sessionId
        );

      if (
        !databaseSession ||
        !databaseSession.access_url ||
        databaseSession.status !== 'ready'
      ) {
        return res
          .status(503)
          .send(
            'Session OpenWebUI indisponible'
          );
      }

      await assertLocalAdminReady(
        launchEntry.sessionId
      );

      const jwt =
        await ensureOpenWebUiJwt(
          launchEntry.sessionId
        );

      const remainingMs = Math.max(
        60 * 1000,
        new Date(
          launchEntry.expiresAt
        ).getTime() - Date.now()
      );

      const redirectPath =
        `/?privalyse_session=${encodeURIComponent(
          launchEntry.sessionId
        )}`;

      res.setHeader(
        'Content-Type',
        'text/html; charset=utf-8'
      );
      res.setHeader(
        'Cache-Control',
        'no-store'
      );
      res.setHeader(
        'Set-Cookie',
        `${PROXY_COOKIE_NAME}=${req.params.token}; ` +
        `Max-Age=${Math.floor(remainingMs / 1000)}; ` +
        'Path=/; HttpOnly; SameSite=Lax'
      );

      return res.end(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=${redirectPath}" />
    <title>Ouverture de la session Privalyse</title>
  </head>
  <body>
    <script>
      try {
        localStorage.setItem('token', ${JSON.stringify(jwt)});
        localStorage.setItem('auth-token', ${JSON.stringify(jwt)});
        sessionStorage.setItem('token', ${JSON.stringify(jwt)});
        window.localStorage.token = ${JSON.stringify(jwt)};
      } catch (error) {}
      window.location.replace(${JSON.stringify(redirectPath)});
    </script>
  </body>
</html>`);
    } catch (error) {
      return res
        .status(error.statusCode || 409)
        .send(error.message);
    }
  }
);

proxyApp.use(async (req, res) => {
  try {
    const proxyContext =
      await resolveAuthorizedProxyContext(
        req,
        req.originalUrl
      );

    const jwt =
      await ensureOpenWebUiJwt(
        proxyContext.sessionId
      );

    return proxyRequestToOpenWebUi(
      req,
      res,
      jwt,
      proxyContext
    );
  } catch (error) {
    return res
      .status(error.statusCode || 502)
      .send(
        error.statusCode
          ? error.message
          : `Proxy OpenWebUI indisponible: ${error.message}`
      );
  }
});

app.use('/health', healthRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Serveur backend demarre sur http://localhost:${PORT}`);
  console.log(`Dossier Terraform : ${TERRAFORM_DIR}`);
  if (ADMIN_TOKEN_ENABLED) {
    console.log('Token administrateur Privalyse actif');
  } else {
    console.log('Mode sans token admin actif pour cette session');
  }
});

const proxyServer = proxyApp.listen(PROXY_PORT, () => {
  console.log(`Passerelle OpenWebUI demarree sur http://localhost:${PROXY_PORT}`);
});

proxyServer.on(
  'upgrade',
  proxyUpgradeToOpenWebUi
);

proxyServer.on(
  'clientError',
  (_error, socket) => {
    destroySocketQuietly(socket);
  }
);
const expiredSessionCleanupTimer = setInterval(
  () => {
    cleanupExpiredSessions().catch((error) => {
      pushLog(
        `Erreur du nettoyage automatique : ${error.message}`,
        'error'
      );
    });
  },
  EXPIRED_SESSION_CLEANUP_INTERVAL_MS
);

expiredSessionCleanupTimer.unref();

(async () => {
  try {
    // 1. Les sessions déjà expirées sont détruites immédiatement.
    await cleanupExpiredSessions();

    // 2. Les sessions encore valides récupèrent leur timer exact.
    await restoreScheduledDestroysFromDatabase();
  } catch (error) {
    pushLog(
      `Erreur de restauration des TTL au démarrage : ${error.message}`,
      'error'
    );
  }
})();



