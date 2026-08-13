document.documentElement.style.visibility =
  'hidden';

async function checkAuthentication() {
  try {
    const response = await fetch(
      '/api/auth/me',
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (response.status === 401) {
      window.location.replace(
        '/login.html'
      );

      return;
    }

    if (!response.ok) {
      throw new Error(
        `Erreur HTTP ${response.status}`
      );
    }

    const authentication =
      await response.json();

    if (
      !authentication ||
      !authentication.user ||
      !authentication.user.id
    ) {
      throw new Error(
        'Réponse d’authentification invalide'
      );
    }

    window.terminiatorAuth =
      authentication;

    document.dispatchEvent(
      new CustomEvent(
        'terminiator:authenticated',
        {
          detail: authentication,
        }
      )
    );

    document.documentElement.style
      .visibility = 'visible';
  } catch (error) {
    console.error(
      'Vérification de connexion impossible :',
      error
    );

    window.location.replace('/login.html');
  }
}

checkAuthentication();
