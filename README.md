# Privalyse

> Plateforme web de déploiement et de gestion de workspaces IA privés et temporaires sur OpenStack.

[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-database-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Terraform](https://img.shields.io/badge/Terraform-required-844FBA?logo=terraform&logoColor=white)](https://www.terraform.io/)
[![OpenStack](https://img.shields.io/badge/OpenStack-API-ED1944?logo=openstack&logoColor=white)](https://www.openstack.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/license/mit)

Privalyse fournit une interface web Express pour authentifier des utilisateurs, stocker les tenants, utilisateurs, groupes et sessions dans PostgreSQL, puis piloter Terraform afin de provisionner une VM OpenStack. La VM initialise Ollama et OpenWebUI, et constitue un workspace IA temporaire pouvant être détruit à la fin de sa durée de vie.

Le dépôt contient un MVP fonctionnel : l'application orchestre les opérations Terraform et affiche leur progression, mais la disponibilité réelle d'OpenStack, de PostgreSQL, de Terraform, de Docker dans la VM et du modèle Ollama dépend de l'environnement d'exécution.

## Table des matières

1. [Fonctionnement général](#1-fonctionnement-général)
2. [Fonctionnalités](#2-fonctionnalités)
3. [Architecture](#3-architecture)
4. [Prérequis](#4-prérequis)
5. [Installation](#5-installation)
6. [PostgreSQL](#6-postgresql)
7. [Configuration `.env`](#7-configuration-env)
8. [OpenStack / Infomaniak](#8-openstack--infomaniak)
9. [Initialisation de la base](#9-initialisation-de-la-base)
10. [Création du premier tenant](#10-création-du-premier-tenant)
11. [Création du premier administrateur](#11-création-du-premier-administrateur)
12. [Validation](#12-validation)
13. [Démarrage](#13-démarrage)
14. [Première connexion](#14-première-connexion)
15. [Création d'un workspace](#15-création-dun-workspace)
16. [Cycle de vie](#16-cycle-de-vie)
17. [Accès OpenWebUI](#17-accès-openwebui)
18. [Administration](#18-administration)
19. [Health checks](#19-health-checks)
20. [Structure du projet](#20-structure-du-projet)
21. [Commandes utiles](#21-commandes-utiles)
22. [Dépannage](#22-dépannage)
23. [Reset BDD local](#23-reset-bdd-local)
24. [States Terraform orphelins](#24-states-terraform-orphelins)
25. [Sécurité](#25-sécurité)
26. [Production](#26-production)
27. [Licence](#27-licence)

## 1. Fonctionnement général

1. L'utilisateur se connecte à Privalyse.
2. Il configure le nom, le mode individuel ou équipe et la durée du workspace.
3. Privalyse crée une session PostgreSQL et lance Terraform dans `web/terraform`.
4. Terraform crée une instance OpenStack et une règle réseau pour le workspace.
5. Le cloud-init installe Docker, Ollama et OpenWebUI, puis télécharge le modèle configuré.
6. Privalyse suit les logs et expose l'accès OpenWebUI via son proxy.
7. La session peut être supprimée manuellement ou automatiquement à expiration.

## 2. Fonctionnalités

- Authentification par email et mot de passe avec cookie de session.
- Gestion des rôles `owner` et `admin`.
- MFA TOTP avec codes de récupération.
- Tenants, utilisateurs, invitations et groupes.
- Workspaces individuels ou associés à un groupe.
- Provisionnement et destruction Terraform sur OpenStack.
- Ollama avec modèle CPU configurable et OpenWebUI dans la VM.
- Journaux Terraform et états de session suivis par l'application.
- Health checks applicatif et PostgreSQL.
- Administration des utilisateurs, mots de passe, invitations et consommation.

## 3. Architecture

```mermaid
flowchart LR
    U[Utilisateur] --> P[Privalyse Node.js / Express]
    P --> DB[(PostgreSQL)]
    P --> T[Terraform]
    T --> OS[OpenStack / Infomaniak]
    OS --> VM[Workspace IA]
    VM --> O[Ollama]
    VM --> W[OpenWebUI]
    P --> W
```

Terraform utilise `web/terraform` comme configuration. Le service Node.js exécute Terraform dans ce répertoire et transmet les variables d'environnement au processus.

## 4. Prérequis

- Node.js 18 ou supérieur.
- npm.
- PostgreSQL accessible par `DATABASE_URL`.
- Terraform dans le `PATH`, ou chemin configuré par `TERRAFORM_BIN`.
- Un projet OpenStack/Infomaniak avec credentials d'application et les ressources réseau, image et flavor attendues.
- Une adresse CIDR autorisée pour les communications backend vers les workspaces.

## 5. Installation

À la racine du dépôt :

```powershell
cd C:\Users\Enzo\Documents\TerminIAtor-clean
Copy-Item .env.example .env
cd web
npm install
```

Complétez ensuite `.env`. Le fichier `.env` racine est chargé par `web/src/config/env.js` et ne doit pas être commité.

## 6. PostgreSQL

Créez une base PostgreSQL, puis renseignez une URL complète :

```dotenv
DATABASE_URL=postgresql://privalyse:mot-de-passe@127.0.0.1:5432/terminiator
DATABASE_SSL=false
```

Les migrations créent les tables applicatives et `schema_migrations` enregistre les fichiers déjà appliqués.

## 7. Configuration `.env`

### Application, authentification et MFA

```dotenv
NODE_ENV=development
PORT=3001
SESSION_PROXY_PORT=3002
TERMINIATOR_ALLOWED_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
AUTH_COOKIE_NAME=terminiator_session
AUTH_SESSION_HOURS=8
MFA_ENCRYPTION_KEY=
MFA_ISSUER=TerminIAtor
MFA_CHALLENGE_TTL_SECONDS=300
MFA_MAX_ATTEMPTS=5
```

`MFA_ENCRYPTION_KEY` est obligatoire et doit être une valeur base64 de 32 octets. Les variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM` configurent l'envoi des invitations lorsqu'elles sont utilisées.

### Bootstrap local

```dotenv
DEMO_ADMIN_EMAIL=
DEMO_ADMIN_PASSWORD=
```

Ces deux variables servent uniquement au script de création du premier owner.

### OpenStack et workspace

```dotenv
OS_AUTH_TYPE=v3applicationcredential
OS_AUTH_URL=https://api.pub1.infomaniak.cloud/identity/v3
OS_APPLICATION_CREDENTIAL_ID=
OS_APPLICATION_CREDENTIAL_SECRET=
OS_IDENTITY_API_VERSION=3
OS_INTERFACE=public
OS_REGION_NAME=dc4-a
TF_VAR_allowed_cidr=203.0.113.10/32
```

Les valeurs par défaut sont notamment le flavor `a4-ram8-disk0`, l'image `Ubuntu 24.04 LTS Noble Numbat`, le réseau `ext-net1`, un volume racine de 40 Gio et le modèle Ollama `qwen2.5:0.5b`. Elles peuvent être ajustées avec les variables `PRIVALYSE_CPU_FLAVOR`, `PRIVALYSE_IMAGE_NAME`, `PRIVALYSE_NETWORK_NAME`, `PRIVALYSE_ROOT_VOLUME_GB` et `PRIVALYSE_OLLAMA_MODEL`.

## 8. OpenStack / Infomaniak

Le provider est défini dans `web/terraform/provider.tf`. Le projet attend une authentification OpenStack par application credential, une région (`dc4-a` par défaut), un réseau externe, une image Ubuntu et un flavor disponibles.

`TF_VAR_allowed_cidr` doit être un CIDR restrictif ; `0.0.0.0/0` est refusé par la validation Terraform. `web/terraform/terraform.tfvars.example` documente les principales variables Terraform sans contenir de credentials.

## 9. Initialisation de la base

Depuis `web` :

```powershell
cd C:\Users\Enzo\Documents\TerminIAtor-clean\web
node src/database/migrate.js
```

Les huit migrations actuelles couvrent le schéma initial, les sessions d'authentification, les invitations, les utilisateurs de session, les groupes, la MFA, les groupes de session et l'usage/facturation.

## 10. Création du premier tenant

```powershell
node src/database/seed-demo-tenant.js
```

Le seed crée `TerminIAtor Demo` avec le slug `terminiator-demo`, s'il n'existe pas déjà.

## 11. Création du premier administrateur

Définissez `DEMO_ADMIN_EMAIL` et `DEMO_ADMIN_PASSWORD` dans `.env`, puis exécutez :

```powershell
node src/database/seed-demo-user.js
```

Le script crée un utilisateur `owner` dans le tenant `terminiator-demo` et ne recrée pas un email déjà présent. Ne publiez jamais le mot de passe, son hash ou les secrets `.env`.

## 12. Validation

Depuis `web` :

```powershell
npm run check
npm test
```

`check` vérifie la syntaxe de `server.js` et `public/script.js`. La suite actuelle utilise `node --test tests/*.test.js`.

## 13. Démarrage

```powershell
cd C:\Users\Enzo\Documents\TerminIAtor-clean\web
npm start
```

Le serveur écoute sur `http://localhost:3001` par défaut. `npm run dev` utilise `nodemon` pour le développement.

## 14. Première connexion

Ouvrez `http://localhost:3001/login.html` et utilisez les identifiants définis par `DEMO_ADMIN_EMAIL` et `DEMO_ADMIN_PASSWORD`. Après connexion, `GET /api/auth/me` renvoie l'utilisateur courant.

## 15. Création d'un workspace

Depuis le tableau de bord, choisissez le nom, le mode `Individuel` ou `Équipe`, le groupe éventuel et une durée de 1, 3, 6, 12 ou 24 heures. Le bouton de création lance le provisionnement ; les logs Terraform apparaissent dans le panneau de journaux techniques.

## 16. Cycle de vie

Le cycle affiché est : configuration, provisioning, utilisation et destruction. La session peut être supprimée manuellement ou automatiquement à expiration ; la destruction retire l'infrastructure temporaire associée.

## 17. Accès OpenWebUI

Le cloud-init démarre Ollama sur le réseau Docker interne, télécharge le modèle configuré et démarre OpenWebUI sur le port 3000 de la VM. Privalyse expose l'accès via son proxy de session.

Le modèle par défaut est `qwen2.5:0.5b`. Les variables Terraform `open_webui_image`, `owui_name`, `owui_email`, `owui_password` et `webui_secret_key` configurent OpenWebUI ; les valeurs sensibles doivent rester dans l'environnement Terraform.

## 18. Administration

La page `admin.html` est réservée aux rôles `owner` et `admin`. Elle permet de consulter l'usage, lister les utilisateurs, inviter des utilisateurs, gérer les invitations et groupes, réinitialiser un mot de passe et gérer la MFA TOTP.

Les endpoints d'administration sont sous `/api/admin`. Les invitations publiques utilisent `/api/invitations/validate` et `/api/invitations/accept`.

## 19. Health checks

```text
GET /health/live
GET /health/ready
GET /health/
```

`/health/live` vérifie que le processus répond. `/health/ready` vérifie également PostgreSQL et renvoie `200` lorsque la base est disponible.

## 20. Structure du projet

```text
.
├── .env.example
├── README.md
└── web
    ├── public/                 Interface dashboard, login et administration
    ├── server.js               Serveur Express et proxy OpenWebUI
    ├── src/config/             Configuration et chargement de .env
    ├── src/controllers/        Contrôleurs HTTP
    ├── src/database/           Connexion, migrations et seeds
    ├── src/middleware/         Authentification et validations
    ├── src/repositories/       Accès PostgreSQL
    ├── src/routes/             Routes auth, admin, sessions et invitations
    ├── src/services/           Terraform, email, auth et MFA
    ├── terraform/              Provider, variables, VM et cloud-init
    └── tests/                  Tests Node.js
```

## 21. Commandes utiles

```powershell
cd web
npm install
npm run check
npm test
node src/database/migrate.js
node src/database/seed-demo-tenant.js
node src/database/seed-demo-user.js
npm start
```

Pour Terraform manuel, travaillez dans `web/terraform`, chargez les variables OpenStack nécessaires et fournissez toutes les variables requises, notamment `webui_secret_key`. Utilisez `terraform init`, `terraform validate` et `terraform plan` avant une opération destructive.

## 22. Dépannage

### Le backend ne démarre pas

Vérifiez Node.js, `DATABASE_URL`, `MFA_ENCRYPTION_KEY` et Terraform dans le `PATH` ou via `TERRAFORM_BIN`.

### `/health/ready` échoue

Vérifiez PostgreSQL, la base cible, `DATABASE_URL` et l'exécution des migrations.

### Terraform est introuvable

Installez Terraform ou définissez `TERRAFORM_BIN` avec le chemin de l'exécutable.

### Le provisionnement OpenStack échoue

Vérifiez les variables `OS_*`, la région, l'image, le réseau, le flavor et `TF_VAR_allowed_cidr`. Consultez les journaux techniques et le state Terraform concerné.

### Le seed de l'owner échoue

Vérifiez les migrations, `seed-demo-tenant.js`, `DEMO_ADMIN_EMAIL` et `DEMO_ADMIN_PASSWORD`.

## 23. Reset BDD local

Cette procédure est destructive et réservée à une base locale explicitement identifiée. Arrêtez le backend, vérifiez `DATABASE_URL`, puis exécutez ces commandes SQL avec votre outil PostgreSQL :

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

Rejouez ensuite les migrations et les seeds souhaités :

```powershell
cd web
node src/database/migrate.js
node src/database/seed-demo-tenant.js
node src/database/seed-demo-user.js
```

Ne lancez jamais ce reset contre une URL distante ou non vérifiée.

## 24. States Terraform orphelins

Les états de sessions peuvent subsister dans `web/terraform-sessions` même si la base ne contient plus la session correspondante. Avant toute destruction, identifiez le dossier contenant `terraform.tfstate`, exécutez `terraform state list` dans ce dossier et vérifiez les ressources `managed`.

Pour une infrastructure orpheline, faites un `terraform plan -destroy`, vérifiez précisément le périmètre, puis utilisez `terraform destroy` uniquement pour le state confirmé. Ne faites pas de `git clean` pour résoudre ce problème et ne supprimez pas manuellement une ressource OpenStack sans vérification.

## 25. Sécurité

- Ne committez jamais `.env`, credentials OpenStack, mots de passe, tokens ou clés MFA.
- Utilisez un `allowed_cidr` restrictif ; `0.0.0.0/0` est refusé par Terraform.
- Utilisez HTTPS et des cookies sécurisés en production (`NODE_ENV=production`).
- Gardez `webui_secret_key`, `owui_password` et les credentials hors des fichiers versionnés.
- Activez la MFA TOTP depuis l'administration.
- Protégez les URL et adresses IP de workspace.
- Vérifiez les plans Terraform avant les opérations de création ou de destruction.

Ces recommandations ne constituent pas une garantie de sécurité globale de l'infrastructure.

## 26. Production

Avant une mise en production, prévoyez une base dédiée et sauvegardée, des credentials OpenStack à privilèges minimaux, l'injection des secrets, HTTPS devant Express, des logs sans secrets, une stratégie de sauvegarde et nettoyage des states, des limites de coût/capacité et la supervision de `/health/live` et `/health/ready`.

Le dépôt fournit les briques applicatives et Terraform, mais pas à lui seul le reverse proxy, la rotation des secrets, les sauvegardes, le monitoring ou la haute disponibilité.

## 27. Licence

Le champ `license` du projet déclare la licence MIT. Le dépôt ne contient pas actuellement de fichier `LICENSE`.
