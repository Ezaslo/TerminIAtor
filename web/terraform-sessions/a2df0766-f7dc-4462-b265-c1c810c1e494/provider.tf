provider "openstack" {
  # L'authentification est lue depuis les variables OS_* du fichier OpenRC OVH.
  region = var.openstack_region
}
