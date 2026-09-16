output "instance_id" {
  description = "Identifiant OpenStack de la VM Privalyse"
  value       = openstack_compute_instance_v2.ai_host.id
}

output "instance_name" {
  description = "Nom de la VM Privalyse"
  value       = openstack_compute_instance_v2.ai_host.name
}

output "instance_public_ip" {
  description = "Adresse IPv4 publique de la VM Privalyse pendant le developpement"
  value       = openstack_compute_instance_v2.ai_host.access_ip_v4
}

output "workspace_access_url" {
  description = "URL HTTPS mTLS utilisee par le backend Privalyse pour joindre le worker"

  value = "https://${openstack_compute_instance_v2.ai_host.access_ip_v4}"
}

output "workspace_summary" {
  description = "Resume technique du workspace Privalyse"

  value = {
    workspace_name  = var.workspace_name
    workspace_slug  = var.workspace_slug
    instance_id     = openstack_compute_instance_v2.ai_host.id
    instance_name   = openstack_compute_instance_v2.ai_host.name
    public_ip       = openstack_compute_instance_v2.ai_host.access_ip_v4
    region          = var.openstack_region
    network         = var.external_network_name
    flavor          = var.instance_type
    compute_profile = "gpu"
    image           = var.image_name
    model           = local.selected_model
    root_volume_gb  = var.root_volume_size_gb
    ttl_hours       = var.session_ttl_hours
    allowed_cidr    = var.allowed_cidr
  }
}