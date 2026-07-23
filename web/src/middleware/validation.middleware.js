const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_INVITATION_ROLES = new Set(['admin', 'member']);

function validateLogin(req, res, next) {
  const email =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : '';

  if (!email || !password) {
    return res.status(400).json({
      error: 'L’email et le mot de passe sont obligatoires.'
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      error: 'Adresse email invalide.'
    });
  }

  req.body.email = email;
  req.body.password = password;

  return next();
}

function validateInvitationCreation(req, res, next) {
  const email =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

  const role =
    typeof req.body?.role === 'string'
      ? req.body.role.trim().toLowerCase()
      : '';

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({
      error: 'L’adresse email est invalide.'
    });
  }

  if (!ALLOWED_INVITATION_ROLES.has(role)) {
    return res.status(400).json({
      error: 'Le rôle doit être admin ou member.'
    });
  }

  req.body.email = email;
  req.body.role = role;

  return next();
}

function validateInvitationAcceptance(req, res, next) {
  const token =
    typeof req.body?.token === 'string'
      ? req.body.token.trim()
      : '';

  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : '';

  if (!token) {
    return res.status(400).json({
      error: 'Le jeton d’invitation est obligatoire.'
    });
  }

  if (password.length < 12 || password.length > 200) {
    return res.status(400).json({
      error: 'Le mot de passe doit contenir entre 12 et 200 caractères.'
    });
  }

  req.body.token = token;
  req.body.password = password;

  return next();
}

const ALLOWED_SESSION_MODES = new Set([
  'individual',
  'team'
]);

const ALLOWED_ANALYSIS_TYPES = new Set([
  'summary',
  'sensitive-clauses',
  'comparison',
  'questions'
]);

function validateDeployment(req, res, next) {
  const workspaceName =
    typeof req.body?.workspaceName === 'string'
      ? req.body.workspaceName.trim()
      : '';

  const sessionMode =
    typeof req.body?.sessionMode === 'string'
      ? req.body.sessionMode.trim().toLowerCase()
      : '';

  const analysisType =
    typeof req.body?.analysisType === 'string'
      ? req.body.analysisType.trim().toLowerCase()
      : '';

  const groupId =
    typeof req.body?.groupId === 'string'
      ? req.body.groupId.trim()
      : '';

  const sessionTtlHours =
    Number(req.body?.sessionTtlHours);

  if (
    workspaceName.length < 3 ||
    workspaceName.length > 80
  ) {
    return res.status(400).json({
      ok: false,
      error:
        'Le nom de session doit contenir entre 3 et 80 caractères.'
    });
  }

  if (!ALLOWED_SESSION_MODES.has(sessionMode)) {
    return res.status(400).json({
      ok: false,
      error: 'Le mode de session est invalide.'
    });
  }

  if (!ALLOWED_ANALYSIS_TYPES.has(analysisType)) {
    return res.status(400).json({
      ok: false,
      error: "Le type d'analyse est invalide."
    });
  }

  if (
    !Number.isInteger(sessionTtlHours) ||
    sessionTtlHours < 1 ||
    sessionTtlHours > 168
  ) {
    return res.status(400).json({
      ok: false,
      error:
        'La durée de session doit être comprise entre 1 et 24 heures.'
    });
  }

  if (sessionMode === 'team' && !groupId) {
    return res.status(400).json({
      ok: false,
      error:
        'Un groupe est requis pour une session en équipe.'
    });
  }

  req.body.workspaceName = workspaceName;
  req.body.sessionMode = sessionMode;
  req.body.analysisType = analysisType;
  req.body.sessionTtlHours = sessionTtlHours;
  req.body.groupId = groupId;

  return next();
}

module.exports = {
  validateLogin,
  validateInvitationCreation,
  validateInvitationAcceptance,
  validateDeployment
};
