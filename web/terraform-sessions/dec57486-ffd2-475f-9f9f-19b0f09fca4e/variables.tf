variable "project" {
  description = "Nom technique du projet"
  type        = string
  default     = "privalyse"
}

variable "openstack_region" {
  description = "Region OVH Public Cloud"
  type        = string
  default     = "GRA11"
}

variable "external_network_name" {
  description = "Nom du reseau public OVH/OpenStack"
  type        = string
  default     = "Ext-Net"
}

variable "image_name" {
  description = "Nom exact de l'image Ubuntu disponible dans le projet OVH"
  type        = string
  default     = "Ubuntu 24.04"
}



variable "workspace_name" {
  description = "Nom lisible de la session"
  type        = string
  default     = "Session IA"
}

variable "workspace_slug" {
  description = "Identifiant court de la session"
  type        = string
  default     = "session-ia"
}

variable "session_ttl_hours" {
  description = "Duree cible de la session en heures"
  type        = number
  default     = 8

  validation {
    condition     = var.session_ttl_hours >= 1 && var.session_ttl_hours <= 168
    error_message = "session_ttl_hours doit etre compris entre 1 et 168."
  }
}

variable "team_size_hint" {
  description = "Nombre estime d'utilisateurs simultanes"
  type        = number
  default     = 5
}

variable "root_volume_size_gb" {
  description = "Taille du volume racine en Gio"
  type        = number
  default     = 120

  validation {
    condition     = var.root_volume_size_gb >= 80
    error_message = "root_volume_size_gb doit etre superieur ou egal a 80."
  }
}

variable "allowed_cidr" {
  description = "IP publique du backend Privalyse au format /32"
  type        = string

  validation {
    condition     = can(cidrhost(var.allowed_cidr, 0)) && var.allowed_cidr != "0.0.0.0/0"
    error_message = "allowed_cidr doit etre un CIDR restrictif, par exemple 203.0.113.10/32."
  }
}

variable "workspace_url" {
  description = "URL Privalyse exposee aux utilisateurs"
  type        = string
  default     = ""
}

variable "auth_mode" {
  description = "Mode d'authentification OpenWebUI"
  type        = string
  default     = "local_admin"

  validation {
    condition     = contains(["local_admin", "trusted_header"], var.auth_mode)
    error_message = "auth_mode doit valoir local_admin ou trusted_header."
  }
}

variable "ai_choice" {
  description = "Identifiant du modele selectionne"
  type        = string
  default     = "qwen-7b"
}

variable "ollama_model" {
  description = "Modele Ollama a precharger"
  type        = string
  default     = "qwen2.5:7b"
}

variable "ollama_image" {
  type    = string
  default = "ollama/ollama:0.21.0"
}

variable "open_webui_image" {
  type    = string
  default = "ghcr.io/open-webui/open-webui:v0.8.12"
}
variable "instance_type" {
  description = "Nom exact du flavor GPU OVH/OpenStack"
  type        = string
  default     = "l4-90"
}
variable "webui_secret_key" {
  type      = string
  sensitive = true
}

variable "owui_name" {
  type    = string
  default = "Admin"
}

variable "owui_email" {
  type    = string
  default = ""
}

variable "owui_password" {
  type      = string
  default   = ""
  sensitive = true
}

variable "trusted_email_header" {
  type    = string
  default = "X-User-Email"
}

variable "trusted_name_header" {
  type    = string
  default = "X-User-Name"
}

variable "trusted_groups_header" {
  type    = string
  default = "X-User-Groups"
}

variable "trusted_role_header" {
  type    = string
  default = "X-User-Role"
}
