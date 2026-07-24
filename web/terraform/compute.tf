data "openstack_images_image_v2" "ubuntu" {
  name        = var.image_name
  most_recent = true
}

data "openstack_compute_flavor_v2" "gpu" {
  name = var.instance_type
}

data "openstack_networking_network_v2" "external" {
  name = var.external_network_name
}

locals {
  ai_catalog = {
    qwen-mini            = "qwen2.5:0.5b"
    llama3-1b            = "llama3.2:1b"
    phi3-mini            = "phi3:mini"
    phi4-mini            = "phi4-mini"
    qwen-7b              = "qwen2.5:7b"
    qwen-14b             = "qwen2.5:14b"
    qwen-coder-14b       = "qwen2.5-coder:14b"
    gpt-oss              = "gpt-oss:20b"
    gpt-oss-20b          = "gpt-oss:20b"
    mistral-small-24b    = "mistral-small3.2:24b"
    dolphin3-8b          = "dolphin3:8b"
    llama2-uncensored-7b = "llama2-uncensored:7b"
  }

  selected_model = lookup(local.ai_catalog, var.ai_choice, var.ollama_model)
}

resource "openstack_compute_instance_v2" "ai_host" {
  name         = "${var.project}-${var.workspace_slug}"
  flavor_id    = data.openstack_compute_flavor_v2.gpu.id
  config_drive = true

  security_groups = [openstack_networking_secgroup_v2.ai.name]

  block_device {
    uuid                  = data.openstack_images_image_v2.ubuntu.id
    source_type           = "image"
    destination_type      = "volume"
    volume_size           = var.root_volume_size_gb
    boot_index            = 0
    delete_on_termination = true
  }

  network {
    uuid = data.openstack_networking_network_v2.external.id
  }

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    ollama_model          = local.selected_model
    ollama_image          = var.ollama_image
    open_webui_image      = var.open_webui_image
    webui_secret_key      = var.webui_secret_key
    owui_name             = var.owui_name
    owui_email            = var.owui_email
    owui_password         = var.owui_password
    workspace_url         = var.workspace_url
    auth_mode             = var.auth_mode
    trusted_email_header  = var.trusted_email_header
    trusted_name_header   = var.trusted_name_header
    trusted_groups_header = var.trusted_groups_header
    trusted_role_header   = var.trusted_role_header
  })

  metadata = {
    project       = var.project
    workspace     = var.workspace_slug
    managed_by    = "terraform"
    session_ttl_h = tostring(var.session_ttl_hours)
  }

  lifecycle {
    precondition {
      condition     = length(trimspace(var.image_name)) > 0
      error_message = "image_name doit contenir le nom exact d'une image OVH."
    }

    precondition {
      condition     = length(trimspace(var.instance_type)) > 0
      error_message = "instance_type doit contenir le nom exact d'un flavor GPU OVH."
    }
  }
}
