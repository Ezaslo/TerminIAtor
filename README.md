
# Privalyse

Privalyse fournit une interface web pour déployer et gérer des workspaces IA.
Le projet s'appuie sur Node.js, PostgreSQL et Terraform.

## Prérequis

- Node.js 18 ou supérieur
- PostgreSQL
- Terraform accessible dans le PATH

## Démarrage local

Copiez `.env.example` vers `.env`, renseignez la configuration nécessaire, puis lancez :

```sh
cd web
npm install
npm start
```

## Health checks

- `/health/live` vérifie que l'application répond.
- `/health/ready` vérifie que l'application et la base PostgreSQL sont disponibles.

## Validation locale

Depuis le répertoire `web`, exécutez `npm run check` pour vérifier la syntaxe JavaScript.
