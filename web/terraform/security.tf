resource "openstack_networking_secgroup_v2" "session" {
  name        = "${var.project}-${var.workspace_slug}-sg"
  description = "Security group isole pour le workspace Privalyse ${var.workspace_slug}"
}

resource "openstack_networking_secgroup_rule_v2" "openwebui_from_backend" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 443
  port_range_max    = 443
  remote_ip_prefix  = var.allowed_cidr
  security_group_id = openstack_networking_secgroup_v2.session.id
}

resource "openstack_networking_secgroup_rule_v2" "ssh_from_admin" {
  count = trimspace(var.ssh_admin_cidr) != "" ? 1 : 0

  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = var.ssh_admin_cidr
  security_group_id = openstack_networking_secgroup_v2.session.id
}
