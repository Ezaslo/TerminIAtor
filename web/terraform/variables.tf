variable "project" {
  description = "Nom technique du projet Privalyse"
  type        = string
  default     = "privalyse"
}

variable "openstack_region" {
  description = "Region OpenStack Infomaniak"
  type        = string
  default     = "dc4-a"
}

variable "external_network_name" {
  description = "Nom du reseau public OpenStack utilise pendant le developpement"
  type        = string
  default     = "ext-net1"
}

variable "image_name" {
  description = "Nom exact de l'image golden GPU Privalyse"
  type        = string
  default     = "privalyse-gpu-golden-final-2026-09-15"
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
  default     = 1

  validation {
    condition     = contains([1, 2, 3], var.session_ttl_hours)
    error_message = "session_ttl_hours doit etre egal a 1, 2 ou 3."
  }
}

variable "team_size_hint" {
  description = "Nombre estime d'utilisateurs simultanes"
  type        = number
  default     = 3
}

variable "root_volume_size_gb" {
  description = "Taille du volume racine en Gio"
  type        = number
  default     = 80

  validation {
    condition     = var.root_volume_size_gb >= 30
    error_message = "root_volume_size_gb doit etre superieur ou egal a 30."
  }
}

variable "allowed_cidr" {
  description = "IP publique du backend TerminIAtor au format CIDR, idealement /32"
  type        = string

  validation {
    condition     = can(cidrhost(var.allowed_cidr, 0)) && var.allowed_cidr != "0.0.0.0/0"
    error_message = "allowed_cidr doit etre un CIDR restrictif, par exemple 203.0.113.10/32."
  }
}

variable "ssh_keypair_name" {
  description = "Nom du keypair OpenStack pour acces SSH temporaire; vide en production"
  type        = string
  default     = ""
}

variable "ssh_admin_cidr" {
  description = "CIDR IPv4 autorise a joindre SSH; vide pour desactiver SSH"
  type        = string
  default     = ""

  validation {
    condition = (
      trimspace(var.ssh_admin_cidr) == "" ||
      (
        can(cidrhost(var.ssh_admin_cidr, 0)) &&
        var.ssh_admin_cidr != "0.0.0.0/0"
      )
    )
    error_message = "ssh_admin_cidr doit etre vide ou un CIDR IPv4 restrictif."
  }
}

variable "workspace_url" {
  description = "URL technique du workspace, si elle doit etre surchargee"
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
  description = "Identifiant du modele IA selectionne"
  type        = string
  default     = "qwen-mini"
}

variable "ollama_model" {
  description = "Modele Ollama CPU a precharger"
  type        = string
  default     = "qwen2.5:0.5b"
}

variable "ollama_image" {
  description = "Image Docker Ollama"
  type        = string
  default     = "ollama/ollama:0.21.0"
}

variable "open_webui_image" {
  description = "Image Docker OpenWebUI"
  type        = string
  default     = "ghcr.io/open-webui/open-webui:v0.8.12"
}

variable "instance_type" {
  description = "Nom exact du flavor GPU OpenStack Infomaniak"
  type        = string
  default     = "nvl4-a16-ram32-disk80-perf2"
}

variable "owui_name" {
  description = "Nom du compte administrateur OpenWebUI"
  type        = string
  default     = "Admin"
}

variable "owui_email" {
  description = "Adresse e-mail du compte administrateur OpenWebUI"
  type        = string
  default     = ""
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
