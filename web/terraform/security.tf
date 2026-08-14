data "openstack_networking_secgroup_v2" "shared" {
  name = "privalyse-workspaces"
}

resource "openstack_networking_secgroup_rule_v2" "openwebui_from_backend" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 3000
  port_range_max    = 3000
  remote_ip_prefix  = var.allowed_cidr
  security_group_id = data.openstack_networking_secgroup_v2.shared.id
}
