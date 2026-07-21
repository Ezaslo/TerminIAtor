const path = require('path');
const { spawnSync } = require('child_process');

// Charge le fichier .env situé à la racine du projet.
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '..', '.env'),
  quiet: true,
});

/**
 * Convertit une variable d'environnement en nombre entier.
 * Si la valeur n'existe pas ou est invalide, utilise la valeur par défaut.
 */
function parseInteger(value, fallback) {
  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue)) {
    return fallback;
  }

  return parsedValue;
}

/**
 * Recherche l'exécutable Terraform.
 *
 * Ordre de recherche :
 * 1. variable TERRAFORM_BIN ;
 * 2. commande "terraform" disponible dans le PATH ;
 * 3. commande "terraform.exe" disponible dans le PATH.
 */
function resolveTerraformBinary() {
  const configuredBinary = (
    process.env.TERRAFORM_BIN || ''
  ).trim();

  if (configuredBinary) {
    return configuredBinary;
  }

  const candidates = [
    'terraform',
    'terraform.exe',
  ];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(
        candidate,
        ['version'],
        {
          shell: false,
          stdio: 'ignore',
        }
      );

      if (result.status === 0) {
        return candidate;
      }
    } catch (_) {
      // Terraform n'a pas été trouvé avec ce candidat.
      // La boucle teste automatiquement le candidat suivant.
    }
  }

  return null;
}

// Port du backend TerminIAtor.
// Valeur par défaut : 3001.
const port = parseInteger(
  process.env.PORT,
  3001
);

// Port du proxy OpenWebUI.
// Valeur par défaut : port du backend + 1, donc 3002.
const proxyPort = parseInteger(
  process.env.SESSION_PROXY_PORT,
  port + 1
);

// Depuis web/src/config, on remonte de trois dossiers
// pour atteindre la racine du projet où se trouvent les fichiers .tf.
const terraformDirectory = path.resolve(
  __dirname,
  '..',
  '..',
  '..'
);

// Token optionnel protégeant les routes d'administration.
const adminToken = (
  process.env.TERMINIATOR_ADMIN_TOKEN || ''
).trim();

// Liste des origines autorisées par CORS.
const allowedOrigins = new Set(
  (
    process.env.TERMINIATOR_ALLOWED_ORIGINS ||
    `http://localhost:${port},http://127.0.0.1:${port}`
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// Toute la configuration est regroupée dans cet objet.
const config = {
  environment:
    process.env.NODE_ENV || 'development',

  port,

  proxyPort,

  terraform: {
    binary: resolveTerraformBinary(),
    directory: terraformDirectory,
  },

  stateFile: path.join(
    terraformDirectory,
    '.terminiator-state.json'
  ),

  admin: {
    token: adminToken,
    tokenEnabled: adminToken !== '',
  },

  cors: {
    allowedOrigins,
  },
};

module.exports = config;