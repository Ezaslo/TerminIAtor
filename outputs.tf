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

output "ai_ready_hint" {
  description = "Quand AI=ready apparait dans les tags EC2, OpenWebUI est disponible"
  value       = "OpenWebUI: http://${aws_instance.ai_host.public_ip}:3000 (modele precharge: ${var.ai_choice})"
}