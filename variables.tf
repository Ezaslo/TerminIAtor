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
  description = "CIDR autorise a acceder a l'IA (par ex. ton IP publique /32)"
  type        = string
  default     = "0.0.0.0/0" # pour tester; ensuite tu pourras mettre ton IP
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
  description = "Mot de passe du compte admin OpenWebUI"
  type        = string
  default     = ""
  sensitive   = true
}
