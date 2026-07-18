output "vpc_id" {
  value       = aws_vpc.main.id
  description = "ID du VPC"
}

output "public_subnet_id" {
  value       = aws_subnet.public_a.id
  description = "ID du subnet public"
}

output "ec2_instance_id" {
  value       = aws_instance.ai_host.id
  description = "ID de l'instance EC2 IA"
}

output "ec2_public_ip" {
  value       = aws_instance.ai_host.public_ip
  description = "IP publique de l'instance"
}

output "workspace_access_url" {
  description = "URL d'acces recommandee pour la session"
  value       = trimspace(var.workspace_url) != "" ? trimspace(var.workspace_url) : "http://${aws_instance.ai_host.public_ip}:3000"
}

output "workspace_summary" {
  description = "Resume de la session d'equipe"
  value = {
    workspace_name = var.workspace_name
    workspace_slug = var.workspace_slug
    auth_mode      = var.auth_mode
    session_ttl    = var.session_ttl_hours
    team_size_hint = var.team_size_hint
    model          = var.ai_choice
    instance_type  = var.instance_type
    access_url     = trimspace(var.workspace_url) != "" ? trimspace(var.workspace_url) : "http://${aws_instance.ai_host.public_ip}:3000"
    allowed_cidr   = var.allowed_cidr
  }
}

output "workspace_access_notes" {
  description = "Notes d'acces a partager avec l'entreprise"
  value       = var.auth_mode == "trusted_header" ? "OpenWebUI attend des headers de confiance. Expose uniquement l'URL/proxy d'entreprise et ne publie pas le port 3000 hors du CIDR du proxy." : "Mode local_admin: partage le lien et le compte admin bootstrap uniquement pour l'administration initiale."
}
