data "openstack_images_image_v2" "ubuntu" {
  name        = var.image_name
  most_recent = true
}

data "openstack_compute_flavor_v2" "cpu" {
  name = var.instance_type
}

data "openstack_networking_network_v2" "external" {
  name = var.external_network_name
}

locals {
  ai_catalog = {
    qwen-mini = "qwen2.5:0.5b"
    llama3-1b = "llama3.2:1b"
  }

  selected_model = lookup(
    local.ai_catalog,
    var.ai_choice,
    var.ollama_model
  )
}

resource "openstack_compute_instance_v2" "ai_host" {
  name         = "${var.project}-${var.workspace_slug}"
  flavor_id    = data.openstack_compute_flavor_v2.cpu.id
  image_id     = data.openstack_images_image_v2.ubuntu.id
  config_drive = true
  key_pair     = length(trimspace(var.ssh_keypair_name)) > 0 ? var.ssh_keypair_name : null

  security_groups = [
    openstack_networking_secgroup_v2.session.name
  ]

  network {
    uuid = data.openstack_networking_network_v2.external.id
  }

  # Runtime provisionne dans l'image golden GPU.
  user_data = null

  metadata = {
    project         = var.project
    workspace       = var.workspace_slug
    managed_by      = "privalyse"
    compute_profile = "gpu"
    session_ttl_h   = tostring(var.session_ttl_hours)
  }

  lifecycle {
    precondition {
      condition     = length(trimspace(var.image_name)) > 0
      error_message = "image_name doit contenir le nom exact d'une image OpenStack."
    }

    precondition {
      condition     = length(trimspace(var.instance_type)) > 0
      error_message = "instance_type doit contenir le nom exact d'un flavor OpenStack."
    }
    precondition {
      condition = (
        (trimspace(var.ssh_keypair_name) == "" && trimspace(var.ssh_admin_cidr) == "") ||
        (trimspace(var.ssh_keypair_name) != "" && trimspace(var.ssh_admin_cidr) != "")
      )
      error_message = "SSH doit etre configure avec ssh_keypair_name ET ssh_admin_cidr, ou avec les deux vides."
    }
  }
}