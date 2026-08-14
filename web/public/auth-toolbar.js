function displayAuthenticationToolbar(authentication) {
  if (!authentication?.user || document.getElementById('terminiator-auth-toolbar')) {
    return;
  }

  const user = authentication.user;
  const isAdminPage = window.location.pathname === '/admin.html';
  const toolbar = document.createElement('div');
  toolbar.id = 'terminiator-auth-toolbar';
  toolbar.innerHTML = `
    <button type="button" class="account-trigger" aria-haspopup="menu" aria-expanded="false">
      <span class="account-avatar" aria-hidden="true"></span>
      <span class="account-copy"><strong></strong><small></small></span>
      <span class="account-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg></span>
    </button>
    <div class="account-menu" role="menu" hidden>
      <a class="terminiator-admin-link" href="/admin.html" role="menuitem" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 14 5l2.5-.2 1 2.2 2.1 1.4-.7 2.4.7 2.4-2.1 1.4-1 2.2-2.5-.2-2 1.5-2-1.5-2.5.2-1-2.2-2.1-1.4.7-2.4-.7-2.4L4.5 7l1-2.2L8 5l2-1.5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
        <span>Administration</span>
      </a>
      <button type="button" class="logout-button" role="menuitem">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></svg>
        <span>Se déconnecter</span>
      </button>
    </div>`;

  const accountTrigger = toolbar.querySelector('.account-trigger');
  const accountMenu = toolbar.querySelector('.account-menu');
  const accountAvatar = toolbar.querySelector('.account-avatar');
  const emailElement = toolbar.querySelector('.account-copy strong');
  const roleElement = toolbar.querySelector('.account-copy small');
  const adminLink = toolbar.querySelector('.terminiator-admin-link');
  const adminNavLink = document.getElementById('adminNavLink');
  const logoutButton = toolbar.querySelector('.logout-button');
  const displayName = user.name || user.email || 'Compte utilisateur';
  const initials = displayName
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  accountAvatar.textContent = initials || '?';
  emailElement.textContent = user.email || displayName;
  roleElement.textContent = `${user.role || 'Utilisateur'} · ${user.tenantName || 'Privalyse'}`;
  if (isAdminPage) {
    adminLink.href = '/';
    adminLink.textContent = 'Retour à l\'accueil';
    adminLink.hidden = false;
  } else {
    adminLink.remove();
    accountMenu.classList.add('account-menu--logout-only');
  }
  if (adminNavLink) {
    adminNavLink.hidden = isAdminPage || !['owner', 'admin', 'member'].includes(user.role);
  }

  const closeMenu = () => {
    accountMenu.hidden = true;
    accountTrigger.setAttribute('aria-expanded', 'false');
    toolbar.classList.remove('menu-open');
  };

  const toggleMenu = () => {
    const open = accountMenu.hidden;
    accountMenu.hidden = !open;
    accountTrigger.setAttribute('aria-expanded', String(open));
    toolbar.classList.toggle('menu-open', open);
  };

  accountTrigger.addEventListener('click', toggleMenu);
  accountTrigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (accountMenu.hidden) toggleMenu();
      logoutButton.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!toolbar.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !accountMenu.hidden) {
      closeMenu();
      accountTrigger.focus();
    }
  });

  if (adminLink.isConnected) {
    adminLink.addEventListener('click', closeMenu);
  }
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      window.location.replace('/login.html');
    }
  });

  const host = document.querySelector('.sidebar-bottom');
  if (host) {
    host.appendChild(toolbar);
  } else {
    document.body.appendChild(toolbar);
  }
}

document.addEventListener('terminiator:authenticated', (event) => {
  displayAuthenticationToolbar(event.detail);
});

if (window.terminiatorAuth) {
  displayAuthenticationToolbar(window.terminiatorAuth);
}
