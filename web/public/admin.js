const usersTableBody = document.getElementById('users-table-body');
const invitationsTableBody = document.getElementById('invitations-table-body');
const groupsContainer = document.getElementById('groups-container');

const tenantName = document.getElementById('tenant-name');
const usersCount = document.getElementById('users-count');
const groupsCount = document.getElementById('groups-count');
const invitationsCount = document.getElementById('invitations-count');

const pageMessage = document.getElementById('page-message');

const invitationForm = document.getElementById('invitation-form');
const invitationEmail = document.getElementById('invitation-email');
const invitationRole = document.getElementById('invitation-role');
const invitationSubmit = document.getElementById('invitation-submit');
const invitationMessage = document.getElementById('invitation-message');

const groupForm = document.getElementById('group-form');
const groupName = document.getElementById('group-name');
const groupSubmit = document.getElementById('group-submit');
const groupMessage = document.getElementById('group-message');

const passwordForm = document.getElementById('password-form');
const currentPasswordInput = document.getElementById('current-password');
const newPasswordInput = document.getElementById('new-password');
const confirmPasswordInput = document.getElementById('confirm-password');
const passwordSubmit = document.getElementById('password-submit');
const passwordMessage = document.getElementById('password-message');
const adminOnlyElements = document.querySelectorAll('.admin-only');
const mfaStatus = document.getElementById('mfa-status');
const mfaSetupButton = document.getElementById('mfa-setup-button');
const mfaSetup = document.getElementById('mfa-setup');
const mfaRecovery = document.getElementById('mfa-recovery');
const mfaDisable = document.getElementById('mfa-disable');
const mfaMessage = document.getElementById('mfa-message');
let mfaSecret = null;

async function loadMfaStatus() {
  const data = await requestJson('/api/auth/mfa/status');
  mfaStatus.textContent = data.enabled ? `MFA active${data.confirmedAt ? ` depuis ${formatDate(data.confirmedAt)}` : ''}.` : 'MFA inactive.';
  mfaStatus.className = `message mfa-status ${data.enabled ? 'mfa-status--enabled' : 'mfa-status--disabled'}`;
  mfaSetupButton.hidden = data.enabled; mfaDisable.hidden = !data.enabled;
}
function displayMfaError(error) { mfaMessage.textContent = error.message || 'Action MFA impossible.'; mfaMessage.className = 'message error'; }
mfaSetupButton.addEventListener('click', async () => { try { const data = await requestJson('/api/auth/mfa/setup', { method: 'POST' }); mfaSecret = data.secret; document.getElementById('mfa-qr').src = data.qrCodeDataUrl; document.getElementById('mfa-secret').textContent = `Secret : ${data.secret}`; mfaSetup.hidden = false; } catch (error) { displayMfaError(error); } });
document.getElementById('mfa-confirm-button').addEventListener('click', async () => { try { const data = await requestJson('/api/auth/mfa/confirm', { method: 'POST', body: { code: document.getElementById('mfa-confirm-code').value } }); document.getElementById('mfa-recovery-codes').textContent = data.recoveryCodes.join('\n'); document.getElementById('mfa-qr').src = ''; document.getElementById('mfa-secret').textContent = ''; document.getElementById('mfa-confirm-code').value = ''; mfaRecovery.hidden = false; mfaSetup.hidden = true; mfaSetupButton.hidden = true; mfaDisable.hidden = false; mfaSecret = null; await loadMfaStatus(); } catch (error) { displayMfaError(error); } });
document.getElementById('mfa-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(document.getElementById('mfa-recovery-codes').textContent); mfaMessage.textContent = 'Codes copiés.'; } catch (error) { displayMfaError(error); } });
document.getElementById('mfa-disable-button').addEventListener('click', async () => { try { await requestJson('/api/auth/mfa', { method: 'DELETE', body: { currentPassword: document.getElementById('mfa-current-password').value, code: document.getElementById('mfa-disable-code').value } }); window.location.replace('/login.html'); } catch (error) { displayMfaError(error); } });

let authenticatedUser = null;
let tenantUsers = [];

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function createCell(value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value ?? '—';
  if (className) cell.className = className;
  return cell;
}

function setMessage(element, message, type = '') {
  element.textContent = message;
  element.className = type ? `message ${type}` : 'message';
}

function displayPageMessage(message, type = '') {
  setMessage(pageMessage, message, type);
}

function isAdministrator(user) {
  return ['owner', 'admin'].includes(user?.role);
}

function configurePageForRole(user) {
  const administrator = isAdministrator(user);
  adminOnlyElements.forEach((element) => {
    element.hidden = !administrator;
  });
}

async function requestJson(url, { method = 'GET', body } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data.error || `Erreur HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function createResetButton(user) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action-button reset-button';
  button.textContent = 'Réinitialiser';

  button.addEventListener('click', async () => {
    const password = window.prompt(`Nouveau mot de passe pour ${user.email} :`);
    if (password === null) return;

    if (!password) {
      displayPageMessage('Le nouveau mot de passe est obligatoire.', 'error');
      return;
    }

    button.disabled = true;
    button.textContent = 'Envoi…';
    displayPageMessage('');

    try {
      const data = await requestJson(
        `/api/admin/users/${encodeURIComponent(user.id)}/password`,
        { method: 'PATCH', body: { password } }
      );

      displayPageMessage(
        data.message || 'Mot de passe réinitialisé avec succès.',
        'success'
      );
    } catch (error) {
      displayPageMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Réinitialiser';
    }
  });

  return button;
}

function createDeleteUserButton(user) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action-button delete-button';
  button.textContent = 'Supprimer';

  if (authenticatedUser?.id === user.id) {
    button.disabled = true;
    button.title = 'Tu ne peux pas supprimer ton propre compte.';
    return button;
  }

  button.addEventListener('click', async () => {
    if (!window.confirm(`Supprimer définitivement le compte ${user.email} ?`)) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Suppression…';
    displayPageMessage('');

    try {
      const data = await requestJson(
        `/api/admin/users/${encodeURIComponent(user.id)}`,
        { method: 'DELETE' }
      );

      displayPageMessage(
        data.message || 'Utilisateur supprimé avec succès.',
        'success'
      );

      await Promise.all([refreshUsers(), refreshGroups()]);
    } catch (error) {
      displayPageMessage(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Supprimer';
    }
  });

  return button;
}

function displayUsers(data) {
  usersTableBody.replaceChildren();
  tenantName.textContent = data.tenant?.name || '—';
  usersCount.textContent = String(data.count ?? 0);
  tenantUsers = Array.isArray(data.users) ? data.users : [];

  if (tenantUsers.length === 0) {
    const row = document.createElement('tr');
    const cell = createCell('Aucun utilisateur.', 'empty-row');
    cell.colSpan = 4;
    row.appendChild(cell);
    usersTableBody.appendChild(row);
    return;
  }

  tenantUsers.forEach((user) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(user.email));
    row.appendChild(createCell(user.role, 'role-badge'));
    row.appendChild(createCell(formatDate(user.createdAt)));

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions-cell';
    actionsCell.append(createResetButton(user), createDeleteUserButton(user));
    row.appendChild(actionsCell);
    usersTableBody.appendChild(row);
  });
}

function displayInvitations(data) {
  invitationsTableBody.replaceChildren();
  invitationsCount.textContent = String(data.count ?? 0);

  const invitations = Array.isArray(data.invitations)
    ? data.invitations
    : [];

  if (invitations.length === 0) {
    const row = document.createElement('tr');
    const cell = createCell('Aucune invitation en attente.', 'empty-row');
    cell.colSpan = 4;
    row.appendChild(cell);
    invitationsTableBody.appendChild(row);
    return;
  }

  invitations.forEach((invitation) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(invitation.email));
    row.appendChild(createCell(invitation.role, 'role-badge'));
    row.appendChild(createCell(invitation.invitedByEmail));
    row.appendChild(createCell(formatDate(invitation.expiresAt)));
    invitationsTableBody.appendChild(row);
  });
}

function createRemoveMemberButton(group, member) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action-button delete-button small-button';
  button.textContent = 'Retirer';

  button.addEventListener('click', async () => {
    if (!window.confirm(`Retirer ${member.email} du groupe ${group.name} ?`)) {
      return;
    }

    button.disabled = true;

    try {
      const data = await requestJson(
        `/api/admin/groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(member.id)}`,
        { method: 'DELETE' }
      );

      displayPageMessage(data.message || 'Membre retiré.', 'success');
      await refreshGroups();
    } catch (error) {
      displayPageMessage(error.message, 'error');
      button.disabled = false;
    }
  });

  return button;
}

function createDeleteGroupButton(group) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action-button delete-button';
  button.textContent = 'Supprimer';

  button.addEventListener('click', async () => {
    if (!window.confirm(`Supprimer définitivement le groupe ${group.name} ?`)) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Suppression…';

    try {
      const data = await requestJson(
        `/api/admin/groups/${encodeURIComponent(group.id)}`,
        { method: 'DELETE' }
      );

      displayPageMessage(data.message || 'Groupe supprimé.', 'success');
      await refreshGroups();
    } catch (error) {
      displayPageMessage(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Supprimer';
    }
  });

  return button;
}

function createMemberForm(group, members) {
  const form = document.createElement('form');
  form.className = 'member-form';

  const field = document.createElement('div');
  field.className = 'field';

  const label = document.createElement('label');
  label.textContent = 'Ajouter un membre';

  const select = document.createElement('select');
  select.required = true;
  select.setAttribute('aria-label', `Ajouter un membre au groupe ${group.name}`);

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choisir un utilisateur';
  select.appendChild(placeholder);

  const memberIds = new Set(members.map((member) => member.id));
  const availableUsers = tenantUsers.filter((user) => !memberIds.has(user.id));

  availableUsers.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = `${user.email} (${user.role})`;
    select.appendChild(option);
  });

  field.append(label, select);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary-button small-button';
  submit.textContent = 'Ajouter';

  const isFull = members.length >= 3;
  const noAvailableUser = availableUsers.length === 0;
  select.disabled = isFull || noAvailableUser;
  submit.disabled = isFull || noAvailableUser;

  if (isFull) {
    placeholder.textContent = 'Limite de 3 membres atteinte';
  } else if (noAvailableUser) {
    placeholder.textContent = 'Aucun utilisateur disponible';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!select.value) return;

    submit.disabled = true;
    submit.textContent = 'Ajout…';

    try {
      const data = await requestJson(
        `/api/admin/groups/${encodeURIComponent(group.id)}/members`,
        { method: 'POST', body: { userId: select.value } }
      );

      displayPageMessage(data.message || 'Membre ajouté.', 'success');
      await refreshGroups();
    } catch (error) {
      displayPageMessage(error.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Ajouter';
    }
  });

  form.append(field, submit);
  return form;
}

function displayGroups(data) {
  groupsContainer.replaceChildren();
  groupsCount.textContent = String(data.count ?? 0);

  const groups = Array.isArray(data.groups) ? data.groups : [];

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'groups-empty';
    empty.textContent = 'Aucun groupe. Créez votre première équipe.';
    groupsContainer.appendChild(empty);
    return;
  }

  groups.forEach((group) => {
    const members = Array.isArray(group.members) ? group.members : [];
    const card = document.createElement('article');
    card.className = 'group-card';

    const header = document.createElement('div');
    header.className = 'group-card-header';

    const titleBlock = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = group.name;

    const meta = document.createElement('p');
    meta.className = 'group-meta';
    meta.textContent = `${members.length}/3 membre${members.length > 1 ? 's' : ''} · créé le ${formatDate(group.created_at || group.createdAt)}`;

    titleBlock.append(title, meta);
    header.append(titleBlock, createDeleteGroupButton(group));

    const membersList = document.createElement('div');
    membersList.className = 'group-members';

    if (members.length === 0) {
      const emptyMember = document.createElement('div');
      emptyMember.className = 'groups-empty';
      emptyMember.textContent = 'Aucun membre dans ce groupe.';
      membersList.appendChild(emptyMember);
    } else {
      members.forEach((member) => {
        const memberRow = document.createElement('div');
        memberRow.className = 'group-member';

        const email = document.createElement('span');
        email.className = 'group-member-email';
        email.textContent = member.email;
        email.title = member.email;

        memberRow.append(email, createRemoveMemberButton(group, member));
        membersList.appendChild(memberRow);
      });
    }

    card.append(header, membersList, createMemberForm(group, members));
    groupsContainer.appendChild(card);
  });
}

async function refreshUsers() {
  const data = await requestJson('/api/admin/users');
  displayUsers(data);
  return data;
}

async function refreshInvitations() {
  const data = await requestJson('/api/admin/invitations');
  displayInvitations(data);
  return data;
}

async function refreshGroups() {
  const data = await requestJson('/api/admin/groups');
  displayGroups(data);
  return data;
}

async function loadAdministrationPage(authentication) {
  authenticatedUser = authentication?.user || null;

  if (!authenticatedUser) {
    window.location.replace('/login.html');
    return;
  }

  configurePageForRole(authenticatedUser);
  try { await loadMfaStatus(); } catch (error) { mfaStatus.textContent = error.message; }

  if (!isAdministrator(authenticatedUser)) {
    displayPageMessage('');
    return;
  }

  try {
    displayPageMessage('');

    const [usersData, invitationsData, groupsData] = await Promise.all([
      requestJson('/api/admin/users'),
      requestJson('/api/admin/invitations'),
      requestJson('/api/admin/groups'),
    ]);

    displayUsers(usersData);
    displayInvitations(invitationsData);
    displayGroups(groupsData);
  } catch (error) {
    displayPageMessage(error.message, 'error');
  }
}

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(passwordMessage, '');

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    setMessage(passwordMessage, 'Tous les champs sont obligatoires.', 'error');
    return;
  }
  if (newPassword.length < 12 || newPassword.length > 200) {
    setMessage(passwordMessage, 'Le nouveau mot de passe doit contenir entre 12 et 200 caractères.', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    setMessage(passwordMessage, 'La confirmation ne correspond pas au nouveau mot de passe.', 'error');
    return;
  }
  if (currentPassword === newPassword) {
    setMessage(passwordMessage, 'Le nouveau mot de passe doit être différent du mot de passe actuel.', 'error');
    return;
  }

  passwordSubmit.disabled = true;
  passwordSubmit.textContent = 'Modification…';

  try {
    const data = await requestJson('/api/auth/password', {
      method: 'PATCH',
      body: { currentPassword, newPassword, confirmPassword },
    });
    passwordForm.reset();
    setMessage(passwordMessage, data.message || 'Mot de passe modifié avec succès.', 'success');
  } catch (error) {
    setMessage(passwordMessage, error.message, 'error');
  } finally {
    passwordSubmit.disabled = false;
    passwordSubmit.textContent = 'Modifier mon mot de passe';
  }
});

invitationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(invitationMessage, '');
  invitationSubmit.disabled = true;
  invitationSubmit.textContent = 'Création…';

  const email = invitationEmail.value.trim().toLowerCase();
  const role = invitationRole.value;

  try {
    const data = await requestJson('/api/admin/invitations', {
      method: 'POST',
      body: { email, role },
    });

    const invitationUrl = new URL(
      data.invitation.acceptancePath,
      window.location.origin
    ).href;

    let copied = false;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      copied = true;
    } catch {
      copied = false;
    }

    invitationMessage.className = 'message success';

    const confirmation = document.createElement('span');
    confirmation.textContent = copied
      ? 'Invitation créée. Le lien a été copié. '
      : 'Invitation créée. ';

    const link = document.createElement('a');
    link.href = invitationUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Ouvrir le lien d’invitation';
    Object.assign(link.style, { color: '#38bdf8', fontWeight: '700' });

    invitationMessage.replaceChildren(confirmation, link);
    invitationForm.reset();
    await refreshInvitations();
  } catch (error) {
    setMessage(invitationMessage, error.message, 'error');
  } finally {
    invitationSubmit.disabled = false;
    invitationSubmit.textContent = 'Créer l’invitation';
  }
});

groupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(groupMessage, '');

  const name = groupName.value.trim();
  if (name.length < 2) {
    setMessage(groupMessage, 'Le nom du groupe est trop court.', 'error');
    return;
  }

  groupSubmit.disabled = true;
  groupSubmit.textContent = 'Création…';

  try {
    const data = await requestJson('/api/admin/groups', {
      method: 'POST',
      body: { name },
    });

    setMessage(groupMessage, data.message || 'Groupe créé.', 'success');
    groupForm.reset();
    await refreshGroups();
  } catch (error) {
    setMessage(groupMessage, error.message, 'error');
  } finally {
    groupSubmit.disabled = false;
    groupSubmit.textContent = 'Créer le groupe';
  }
});

document.addEventListener('terminiator:authenticated', (event) => {
  loadAdministrationPage(event.detail);
});

if (window.terminiatorAuth) {
  loadAdministrationPage(window.terminiatorAuth);
}
