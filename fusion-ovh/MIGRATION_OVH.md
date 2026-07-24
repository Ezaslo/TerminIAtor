# Fusion collègue + OVH

Cette archive conserve les ajouts récents de la branche distante et remplace l'infrastructure AWS par OVH Public Cloud/OpenStack.

## Changements principaux

- conservation de Helmet, du rate limiting, des validations, des routes health et des routes groupes ;
- suppression de l'import et du service AWS devenus inutiles ;
- flavor GPU OVH configurable avec `OVH_GPU_FLAVOR` ;
- sorties Terraform `instance_public_ip` et `instance_id` ;
- destruction Terraform complète sans cibles AWS ;
- infrastructure OVH placée dans `web/terraform` ;
- suppression des anciens fichiers Terraform AWS placés à la racine.

## Vérifications

```powershell
node --check .\web\server.js
terraform -chdir=.\web\terraform fmt -check
terraform -chdir=.\web\terraform init
terraform -chdir=.\web\terraform validate
```
