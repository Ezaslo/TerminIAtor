# TerminIAtor

TerminIAtor est un orchestrateur interne qui permet a une entreprise de creer une session IA temporaire dans son propre AWS depuis une page web. L'objectif n'est pas de montrer Terraform ou AWS aux utilisateurs finaux, mais de leur fournir un lien d'acces simple vers un espace IA d'equipe.

## Vision V1

- 1 session d'equipe = 1 VM temporaire
- plusieurs utilisateurs sur la meme session
- destruction manuelle ou automatisee apres un delai
- deux modes d'acces :
  - `local_admin` pour un demarrage rapide
  - `trusted_header` pour un acces sans mot de passe via proxy/SSO d'entreprise

## Cas d'usage cible

Une entreprise heberge TerminIAtor sur un serveur interne ou un bastion d'administration. Un responsable cree une session, choisit le modele et la puissance, puis partage le lien aux utilisateurs. La VM est deployee dans le compte AWS de l'entreprise, pas dans celui de l'editeur du produit.

## Prerequis

- Node.js 18 ou plus
- Terraform 1.6 ou plus
- AWS CLI configure avec un profil autorise a creer VPC, EC2, IAM, Security Groups et volumes EBS
- quotas AWS suffisants pour les instances choisies, surtout `g4dn.*`

## Installation

```powershell
cd web
npm install
Copy-Item ..\.env.example ..\.env
```

Edite ensuite `.env` et remplace `TERMINIATOR_ADMIN_TOKEN` par un token long et aleatoire.

## Lancement local

```powershell
cd web
$env:TERMINIATOR_ADMIN_TOKEN="change-me-with-a-long-random-token"
npm start
```

Puis ouvre `http://localhost:3001`.

## Parcours V1

1. Renseigner le nom de session, la duree et le nombre d'utilisateurs.
2. Choisir le mode d'acces :
   - `local_admin` pour un compte OpenWebUI local. C'est le bon mode pour les tests directs sur l'IP AWS.
   - `trusted_header` si l'entreprise a deja un proxy/SSO qui injecte les headers d'identite.
3. Choisir le modele et la machine AWS.
4. Lancer la creation.
5. Recuperer l'URL finale et la partager a l'equipe.

## Tests recommandes

- Pour un test simple, utilise `local_admin`.
- Si tu ouvres directement `http://<ip-publique>:3000`, n'utilise pas `trusted_header`.
- `trusted_header` ne fonctionne que derriere une URL d'entreprise ou un proxy qui envoie bien les headers attendus.

## Destruction

- `Detruire la session et le reseau` : supprime la VM, le security group, les ressources IAM temporaires, le VPC, le subnet, la route et l'Internet Gateway.
- Objectif : hors session, il ne doit plus rester de compute actif ni de reseau temporaire facture pour ce deploiement.

## Mode trusted_header

Ce mode prepare OpenWebUI pour une connexion automatique via proxy de confiance.

OpenWebUI attend alors des headers comme :

- `X-User-Email`
- `X-User-Name`
- `X-User-Groups`
- `X-User-Role`

Tu peux changer leurs noms dans l'interface avant le deploiement.

Important :

- ne publie pas OpenWebUI directement sur Internet
- limite `allowed_cidr` a l'IP du proxy, du VPN ou du reseau d'entreprise
- le proxy doit etre le seul composant capable d'injecter les trusted headers

Reference officielle :

- [Open WebUI SSO / Trusted Header](https://docs.openwebui.com/features/auth/sso)

## Securite actuelle

- token admin requis pour les routes deploy/destroy et les logs SSE
- `allowed_cidr` obligatoire et `0.0.0.0/0` refuse
- Ollama n'est plus expose publiquement
- mot de passe OpenWebUI non ecrit dans `terraform.tfvars`
- secret OpenWebUI genere pour chaque session
- images Docker OpenWebUI/Ollama pinnees

## Verifications locales

```powershell
cd web
npm run check
npm audit --omit=dev
```

Quand Terraform est installe :

```powershell
terraform init -backend=false -input=false
terraform fmt -check
terraform validate
```

## Limites connues

- pas encore de destruction automatique pilotee par scheduler
- pas encore de proxy/SSO provisionne automatiquement par Terraform
- pas encore de CI ou de tests end-to-end AWS
- l'UX doit encore etre simplifiee pour un public totalement non technique
