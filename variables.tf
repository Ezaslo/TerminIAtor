variable "project" {
  description = "Nom du projet (taggage des ressources)"
  type        = string
  default     = "terminiator"
}

variable "aws_region" {
  description = "Region AWS"
  type        = string
  default     = "eu-west-3" # Paris
}

variable "aws_profile" {
  description = "Profil AWS CLI a utiliser"
  type        = string
  default     = "default"
}

variable "vpc_cidr" {
  description = "CIDR du VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR du subnet public"
  type        = string
  default     = "10.0.1.0/24"
}

variable "az" {
  description = "Zone de dispo pour le subnet"
  type        = string
  default     = "eu-west-3a"
}

variable "tags" {
  description = "Tags communs"
  type        = map(string)
  default = {
    "Environment" = "dev"
    "ManagedBy"   = "terraform"
  }
}

variable "instance_type" {
  description = "Type d'instance pour l'hote IA (GPU recommande)"
  type        = string
  default     = "g4dn.xlarge"
}

variable "workspace_name" {
  description = "Nom lisible de la session d'equipe"
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

  validation {
    condition     = var.team_size_hint >= 1 && var.team_size_hint <= 200
    error_message = "team_size_hint doit etre compris entre 1 et 200."
  }
}

variable "root_volume_size_gb" {
  description = "Taille minimale du disque root EBS (GiB). Le systeme peut augmenter selon le modele choisi."
  type        = number
  default     = 120

  validation {
    condition     = var.root_volume_size_gb >= 80
    error_message = "root_volume_size_gb doit etre >= 80 GiB."
  }
}

variable "ollama_model" {
  description = "Nom du modele Ollama a pre-telecharger"
  type        = string
  default     = "qwen2.5:0.5b"
}

variable "ai_choice" {
  description = "Choix du modele IA (catalogue ci-dessous)"
  type        = string
  default     = "qwen-mini"
  validation {
    condition = contains([
      "qwen-mini",
      "llama3-1b",
      "phi3-mini",
      "phi4-mini",
      "qwen-7b",
      "qwen-14b",
      "qwen-coder-14b",
      "gpt-oss",
      "gpt-oss-20b",
      "mistral-small-24b",
      "dolphin3-8b",
      "llama2-uncensored-7b"
    ], var.ai_choice)
    error_message = "ai_choice doit etre une valeur valide du catalogue (voir web/public/index.html)."
  }
}

variable "allowed_cidr" {
  description = "CIDR IPv4 autorise a acceder a la session (proxy d'entreprise, VPN ou IP publique /32). Ne pas utiliser 0.0.0.0/0."
  type        = string

  validation {
    condition     = can(cidrhost(var.allowed_cidr, 0)) && var.allowed_cidr != "0.0.0.0/0"
    error_message = "allowed_cidr doit etre un CIDR valide et plus restrictif que 0.0.0.0/0, par exemple 203.0.113.10/32."
  }
}

variable "workspace_url" {
  description = "URL publique de la session si un proxy/SSO d'entreprise est place devant OpenWebUI"
  type        = string
  default     = ""
}

variable "auth_mode" {
  description = "Mode d'acces a la session: local_admin ou trusted_header"
  type        = string
  default     = "local_admin"

  validation {
    condition     = contains(["local_admin", "trusted_header"], var.auth_mode)
    error_message = "auth_mode doit valoir local_admin ou trusted_header."
  }
}

variable "webui_secret_key" {
  description = "Secret de session OpenWebUI partage par toutes les instances"
  type        = string
  sensitive   = true
}

variable "trusted_email_header" {
  description = "Header HTTP qui porte l'email utilisateur dans le mode trusted_header"
  type        = string
  default     = "X-User-Email"
}

variable "trusted_name_header" {
  description = "Header HTTP qui porte le nom utilisateur dans le mode trusted_header"
  type        = string
  default     = "X-User-Name"
}

variable "trusted_groups_header" {
  description = "Header HTTP qui porte les groupes utilisateur dans le mode trusted_header"
  type        = string
  default     = "X-User-Groups"
}

variable "trusted_role_header" {
  description = "Header HTTP qui porte le role utilisateur dans le mode trusted_header"
  type        = string
  default     = "X-User-Role"
}

variable "ollama_image" {
  description = "Image Docker Ollama pinnee pour des deploiements reproductibles"
  type        = string
  default     = "ollama/ollama:0.21.0"
}

variable "open_webui_image" {
  description = "Image Docker OpenWebUI pinnee pour des deploiements reproductibles"
  type        = string
  default     = "ghcr.io/open-webui/open-webui:v0.8.12"
}

variable "owui_name" {
  description = "Nom affiche du compte admin OpenWebUI"
  type        = string
  default     = "Admin"
}

variable "owui_email" {
  description = "Email du compte admin OpenWebUI (utilise comme identifiant de connexion)"
  type        = string
  default     = ""
}

variable "owui_password" {
  description = "Mot de passe du compte admin OpenWebUI de bootstrap"
  type        = string
  default     = ""
  sensitive   = true
}
