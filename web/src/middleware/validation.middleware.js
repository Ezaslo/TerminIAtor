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

  if (!email || !password || Buffer.byteLength(password, 'utf8') > 1024) {
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



function validateDeployment(req, res, next) {
  const workspaceName =
    typeof req.body?.workspaceName === 'string'
      ? req.body.workspaceName.trim()
      : '';

  const sessionMode =
    typeof req.body?.sessionMode === 'string'
      ? req.body.sessionMode.trim().toLowerCase()
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
  req.body.sessionTtlHours = sessionTtlHours;
  req.body.groupId = groupId;

  return next();
}

function validatePasswordChange(req, res, next) {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'Le mot de passe actuel, le nouveau mot de passe et sa confirmation sont obligatoires.' });
  }
  if (newPassword.length < 12 || newPassword.length > 200) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir entre 12 et 200 caractères.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'La confirmation du nouveau mot de passe ne correspond pas.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent du mot de passe actuel.' });
  }

  req.body.currentPassword = currentPassword;
  req.body.newPassword = newPassword;
  delete req.body.confirmPassword;
  return next();
}

function validateAdminPasswordReset(req, res, next) {
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
  if (!newPassword || !confirmPassword || Buffer.byteLength(newPassword, 'utf8') > 1024 || Buffer.byteLength(confirmPassword, 'utf8') > 1024 || newPassword.length < 12 || newPassword.length > 200 || newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Le nouveau mot de passe est invalide.' });
  }
  req.body.newPassword = newPassword;
  req.body.confirmPassword = confirmPassword;
  return next();
}

function validateMfaCode(req, res, next) {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const isValid = /^\d{6}$/.test(code);
  if (!isValid) {
    return res.status(400).json({ error: 'Code MFA invalide.' });
  }
  req.body.code = code;
  return next();
}
function validateMfaChallenge(req, res, next) {
  const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge : '';
  const isValid = /^[A-Za-z0-9_-]{40,100}$/.test(challenge);
  if (!isValid) {
    return res.status(400).json({ error: 'Challenge MFA invalide.' });
  }
  req.body.challenge = challenge;
  return next();
}
function validateRecoveryLogin(req, res, next) {
  const challenge = typeof req.body?.challenge === 'string' ? req.body.challenge : '';
  const recoveryCode = typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode.trim() : '';
  const validChallenge = /^[A-Za-z0-9_-]{40,100}$/.test(challenge);
  const validRecoveryCode = recoveryCode.length <= 32 && Boolean(recoveryCode);
  if (!validChallenge || !validRecoveryCode) {
    return res.status(400).json({ error: 'Code de récupération invalide.' });
  }
  req.body.challenge = challenge;
  req.body.recoveryCode = recoveryCode;
  return next();
}
function validateDisableMfa(req, res, next) {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const isValid = currentPassword && Buffer.byteLength(currentPassword, 'utf8') <= 1024;
  if (!isValid) {
    return res.status(400).json({ error: 'Mot de passe invalide.' });
  }
  req.body.currentPassword = currentPassword;
  return validateMfaCode(req, res, next);
}

module.exports = {
  validateLogin,
  validateInvitationCreation,
  validateInvitationAcceptance,
  validateDeployment,
  validatePasswordChange,
  validateAdminPasswordReset,
  validateMfaCode,
  validateMfaChallenge,
  validateRecoveryLogin,
  validateDisableMfa
};
