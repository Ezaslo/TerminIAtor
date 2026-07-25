output "instance_id" {
  description = "Identifiant OpenStack de la VM"
  value       = openstack_compute_instance_v2.ai_host.id
}

output "instance_public_ip" {
  description = "Adresse IPv4 de la VM sur le reseau public"
  value       = openstack_compute_instance_v2.ai_host.access_ip_v4
}

output "workspace_access_url" {
  description = "URL interne utilisee par le reverse proxy Privalyse"
  value = trimspace(var.workspace_url) != "" ? trimspace(var.workspace_url) : (
    "http://${openstack_compute_instance_v2.ai_host.access_ip_v4}:3000"
  )
}

output "workspace_summary" {
  value = {
    workspace_name = var.workspace_name
    workspace_slug = var.workspace_slug
    region         = var.openstack_region
    flavor         = var.instance_type
    image          = var.image_name
    model          = var.ai_choice
    ttl_hours      = var.session_ttl_hours
    allowed_cidr   = var.allowed_cidr
  }
}
