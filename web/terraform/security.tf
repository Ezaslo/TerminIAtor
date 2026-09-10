resource "openstack_networking_secgroup_v2" "session" {
  name        = "${var.project}-${var.workspace_slug}-sg"
  description = "Security group isole pour le workspace Privalyse ${var.workspace_slug}"
}

resource "openstack_networking_secgroup_rule_v2" "openwebui_from_backend" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 3000
  port_range_max    = 3000
  remote_ip_prefix  = var.allowed_cidr
  security_group_id = openstack_networking_secgroup_v2.session.id
}
