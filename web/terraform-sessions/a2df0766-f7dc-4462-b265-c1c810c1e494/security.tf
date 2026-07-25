resource "openstack_networking_secgroup_v2" "ai" {
  name        = "${var.project}-${var.workspace_slug}-ai"
  description = "OpenWebUI accessible uniquement depuis le backend Privalyse"
}

resource "openstack_networking_secgroup_rule_v2" "webui_from_backend" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 3000
  port_range_max    = 3000
  remote_ip_prefix  = var.allowed_cidr
  security_group_id = openstack_networking_secgroup_v2.ai.id
}

resource "openstack_networking_secgroup_rule_v2" "egress_ipv4" {
  direction         = "egress"
  ethertype         = "IPv4"
  security_group_id = openstack_networking_secgroup_v2.ai.id
}
