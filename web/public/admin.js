const usersTableBody =
  document.getElementById(
    'users-table-body'
  );

const invitationsTableBody =
  document.getElementById(
    'invitations-table-body'
  );

const tenantName =
  document.getElementById(
    'tenant-name'
  );

const usersCount =
  document.getElementById(
    'users-count'
  );

const invitationsCount =
  document.getElementById(
    'invitations-count'
  );

const pageMessage =
  document.getElementById(
    'page-message'
  );

const invitationForm =
  document.getElementById(
    'invitation-form'
  );

const invitationEmail =
  document.getElementById(
    'invitation-email'
  );

const invitationRole =
  document.getElementById(
    'invitation-role'
  );

const invitationSubmit =
  document.getElementById(
    'invitation-submit'
  );

const invitationMessage =
  document.getElementById(
    'invitation-message'
  );

/**
 * Transforme une date PostgreSQL en date lisible.
 */
function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return '—';
  }

  return new Intl.DateTimeFormat(
    'fr-FR',
    {
      dateStyle: 'short',
      timeStyle: 'short',
    }
  ).format(date);
}

/**
 * Crée une cellule de tableau.
 */
function createCell(
  value,
  className = ''
) {
  const cell =
    document.createElement('td');

  cell.textContent =
    value ?? '—';

  if (className) {
    cell.className = className;
  }

  return cell;
}

/**
 * Affiche les utilisateurs du tenant.
 */
function displayUsers(data) {
  usersTableBody.replaceChildren();

  tenantName.textContent =
    data.tenant?.name || '—';

  usersCount.textContent =
    String(data.count ?? 0);

  const users =
    Array.isArray(data.users)
      ? data.users
      : [];

  if (users.length === 0) {
    const row =
      document.createElement('tr');

    const cell =
      createCell(
        'Aucun utilisateur.',
        'empty-row'
      );

    cell.colSpan = 3;

    row.appendChild(cell);

    usersTableBody.appendChild(row);

    return;
  }

  users.forEach((user) => {
    const row =
      document.createElement('tr');

    row.appendChild(
      createCell(user.email)
    );

    row.appendChild(
      createCell(
        user.role,
        'role-badge'
      )
    );

    row.appendChild(
      createCell(
        formatDate(user.createdAt)
      )
    );

    usersTableBody.appendChild(row);
  });
}

/**
 * Affiche les invitations encore valides.
 */
function displayInvitations(data) {
  invitationsTableBody.replaceChildren();

  invitationsCount.textContent =
    String(data.count ?? 0);

  const invitations =
    Array.isArray(data.invitations)
      ? data.invitations
      : [];

  if (invitations.length === 0) {
    const row =
      document.createElement('tr');

    const cell =
      createCell(
        'Aucune invitation en attente.',
        'empty-row'
      );

    cell.colSpan = 4;

    row.appendChild(cell);

    invitationsTableBody.appendChild(
      row
    );

    return;
  }

  invitations.forEach(
    (invitation) => {
      const row =
        document.createElement('tr');

      row.appendChild(
        createCell(invitation.email)
      );

      row.appendChild(
        createCell(
          invitation.role,
          'role-badge'
        )
      );

      row.appendChild(
        createCell(
          invitation.invitedByEmail
        )
      );

      row.appendChild(
        createCell(
          formatDate(
            invitation.expiresAt
          )
        )
      );

      invitationsTableBody.appendChild(
        row
      );
    }
  );
}

/**
 * Exécute une requête GET et renvoie le JSON.
 */
async function fetchJson(url) {
  const response = await fetch(
    url,
    {
      method: 'GET',
      credentials: 'same-origin',

      headers: {
        Accept: 'application/json',
      },
    }
  );

  const data =
    await response.json();

  if (!response.ok) {
    const error = new Error(
      data.error ||
      `Erreur HTTP ${response.status}`
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

/**
 * Exécute une requête POST JSON.
 */
async function postJson(
  url,
  body
) {
  const response = await fetch(
    url,
    {
      method: 'POST',
      credentials: 'same-origin',

      headers: {
        'Content-Type':
          'application/json',

        Accept: 'application/json',
      },

      body: JSON.stringify(body),
    }
  );

  const data =
    await response.json();

  if (!response.ok) {
    const error = new Error(
      data.error ||
      `Erreur HTTP ${response.status}`
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

/**
 * Recharge les invitations visibles.
 */
async function refreshInvitations() {
  const invitationsData =
    await fetchJson(
      '/api/admin/invitations'
    );

  displayInvitations(
    invitationsData
  );
}

/**
 * Charge les données de la page admin.
 */
async function loadAdministrationPage(
  authentication
) {
  const role =
    authentication?.user?.role;

  if (
    !['owner', 'admin'].includes(role)
  ) {
    window.location.replace('/');

    return;
  }

  try {
    pageMessage.textContent = '';
    pageMessage.className =
      'message';

    const [
      usersData,
      invitationsData,
    ] = await Promise.all([
      fetchJson(
        '/api/admin/users'
      ),

      fetchJson(
        '/api/admin/invitations'
      ),
    ]);

    displayUsers(usersData);

    displayInvitations(
      invitationsData
    );
  } catch (error) {
    pageMessage.textContent =
      error.message;

    pageMessage.className =
      'message error';
  }
}

/**
 * Création d’une invitation depuis le formulaire.
 */
invitationForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    invitationMessage.replaceChildren();

    invitationMessage.className =
      'message';

    invitationSubmit.disabled = true;

    invitationSubmit.textContent =
      'Création…';

    const email =
      invitationEmail.value
        .trim()
        .toLowerCase();

    const role =
      invitationRole.value;

    try {
      const data = await postJson(
        '/api/admin/invitations',
        {
          email,
          role,
        }
      );

      const invitationUrl =
        new URL(
          data.invitation.acceptancePath,
          window.location.origin
        ).href;

      let copied = false;

      try {
        await navigator.clipboard.writeText(
          invitationUrl
        );

        copied = true;
      } catch {
        copied = false;
      }

      invitationMessage.className =
        'message success';

      const confirmation =
        document.createElement('span');

      confirmation.textContent =
        copied
          ? 'Invitation créée. Le lien a été copié. '
          : 'Invitation créée. ';

      const link =
        document.createElement('a');

      link.href = invitationUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      link.textContent =
        'Ouvrir le lien d’invitation';

      Object.assign(
        link.style,
        {
          color: '#38bdf8',
          fontWeight: '700',
        }
      );

      invitationMessage.append(
        confirmation,
        link
      );

      invitationForm.reset();

      await refreshInvitations();
    } catch (error) {
      invitationMessage.textContent =
        error.message;

      invitationMessage.className =
        'message error';
    } finally {
      invitationSubmit.disabled = false;

      invitationSubmit.textContent =
        'Créer l’invitation';
    }
  }
);

/**
 * Attend que auth-guard.js fournisse
 * l’utilisateur connecté.
 */
document.addEventListener(
  'terminiator:authenticated',
  (event) => {
    loadAdministrationPage(
      event.detail
    );
  }
);

/**
 * Cas où l’authentification est déjà terminée
 * avant le chargement de ce fichier.
 */
if (window.terminiatorAuth) {
  loadAdministrationPage(
    window.terminiatorAuth
  );
}