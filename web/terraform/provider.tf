provider "openstack" {
  # L'authentification est fournie par les variables
  # d'environnement OS_* utilisant une Application Credential.
  #
  # Aucun secret OpenStack ne doit être stocké dans Terraform.
  region = var.openstack_region
}