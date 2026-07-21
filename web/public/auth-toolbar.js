function displayAuthenticationToolbar(
  authentication
) {
  if (
    !authentication ||
    !authentication.user ||
    document.getElementById(
      'terminiator-auth-toolbar'
    )
  ) {
    return;
  }

  const toolbar =
    document.createElement('div');

  toolbar.id =
    'terminiator-auth-toolbar';

  toolbar.innerHTML = `
    <div class="terminiator-auth-user">
      <strong></strong>
      <span></span>
    </div>

    <button type="button">
      Se déconnecter
    </button>
  `;

  const emailElement =
    toolbar.querySelector('strong');

  const roleElement =
    toolbar.querySelector('span');

  const logoutButton =
    toolbar.querySelector('button');

  emailElement.textContent =
    authentication.user.email;

  roleElement.textContent =
    `${authentication.user.role} · ${
      authentication.user.tenantName
    }`;

  Object.assign(toolbar.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '9999',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px 14px',
    border: '1px solid #334155',
    borderRadius: '12px',
    background: '#0f172a',
    color: '#f8fafc',
    boxShadow:
      '0 12px 30px rgba(0, 0, 0, 0.3)',
    fontFamily: 'Arial, sans-serif',
  });

  Object.assign(
    toolbar.querySelector(
      '.terminiator-auth-user'
    ).style,
    {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
    }
  );

  Object.assign(roleElement.style, {
    color: '#94a3b8',
    fontSize: '12px',
  });

  Object.assign(logoutButton.style, {
    padding: '8px 12px',
    border: '0',
    borderRadius: '8px',
    cursor: 'pointer',
    background: '#dc2626',
    color: '#ffffff',
    fontWeight: '700',
  });

  logoutButton.addEventListener(
    'click',
    async () => {
      logoutButton.disabled = true;
      logoutButton.textContent =
        'Déconnexion…';

      try {
        await fetch(
          '/api/auth/logout',
          {
            method: 'POST',
            credentials: 'same-origin',
          }
        );
      } finally {
        window.location.replace(
          '/login.html'
        );
      }
    }
  );

  document.body.appendChild(toolbar);
}

document.addEventListener(
  'terminiator:authenticated',
  (event) => {
    displayAuthenticationToolbar(
      event.detail
    );
  }
);

if (window.terminiatorAuth) {
  displayAuthenticationToolbar(
    window.terminiatorAuth
  );
}