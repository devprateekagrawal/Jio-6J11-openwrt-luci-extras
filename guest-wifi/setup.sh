#!/bin/sh
# Creates the guest network the Guest Wi-Fi page controls, if you don't have one:
#   - bridge br-guest, interface "guest" on 192.168.2.1/24, DHCP (2 h leases), no IPv6
#   - one guest AP per radio (ifname guest2g / guest5g / guest6g), WPA2/WPA3,
#     client isolation on, starting disabled with a random password
#   - firewall zone "guest": internet only (no LAN, no router access except DHCP/DNS)
#   - guest DNS forced to the router (nft snippet 50-guest-dns.nft)
# Run on the router: sh setup.sh ["Guest SSID"] [subnet prefix, default 192.168.2]
set -e
SSID=${1:-Guest}
NET=${2:-192.168.2}

if uci -q get network.guest >/dev/null; then
	echo "A network called \"guest\" already exists; leaving it as it is."
	echo "The page uses every wifi-iface on network \"guest\" (give each an ifname like guest2g)."
	exit 0
fi

uci batch <<-EOF
	set network.guest_dev=device
	set network.guest_dev.name='br-guest'
	set network.guest_dev.type='bridge'
	set network.guest_dev.bridge_empty='1'
	set network.guest=interface
	set network.guest.proto='static'
	set network.guest.device='br-guest'
	set network.guest.ipaddr='$NET.1/24'

	set dhcp.guest=dhcp
	set dhcp.guest.interface='guest'
	set dhcp.guest.start='100'
	set dhcp.guest.limit='100'
	set dhcp.guest.leasetime='2h'
	set dhcp.guest.dhcpv4='server'
	set dhcp.guest.ra='disabled'
	set dhcp.guest.dhcpv6='disabled'
	set dhcp.guest.ndp='disabled'

	set firewall.guest=zone
	set firewall.guest.name='guest'
	set firewall.guest.network='guest'
	set firewall.guest.input='REJECT'
	set firewall.guest.output='ACCEPT'
	set firewall.guest.forward='REJECT'
	set firewall.guest_wan=forwarding
	set firewall.guest_wan.src='guest'
	set firewall.guest_wan.dest='wan'
	set firewall.guest_dhcp=rule
	set firewall.guest_dhcp.name='Guest-DHCP'
	set firewall.guest_dhcp.src='guest'
	set firewall.guest_dhcp.proto='udp'
	set firewall.guest_dhcp.dest_port='67'
	set firewall.guest_dhcp.family='ipv4'
	set firewall.guest_dhcp.target='ACCEPT'
	set firewall.guest_dns=rule
	set firewall.guest_dns.name='Guest-DNS'
	set firewall.guest_dns.src='guest'
	set firewall.guest_dns.proto='tcp udp'
	set firewall.guest_dns.dest_port='53'
	set firewall.guest_dns.target='ACCEPT'
EOF

# one guest AP per radio, named after its band
key=$(tr -dc 'a-km-np-zA-HJ-NP-Z2-9' </dev/urandom | head -c 10)
for r in $(uci -q show wireless | sed -n "s/^wireless\.\([^.=]*\)=wifi-device$/\1/p"); do
	band=$(uci -q get wireless.$r.band || echo $r)
	s=guest_$r
	uci batch <<-EOF
		set wireless.$s=wifi-iface
		set wireless.$s.device='$r'
		set wireless.$s.network='guest'
		set wireless.$s.mode='ap'
		set wireless.$s.encryption='sae-mixed'
		set wireless.$s.key='$key'
		set wireless.$s.isolate='1'
		set wireless.$s.ifname='guest$band'
		set wireless.$s.disabled='1'
	EOF
	# outside the batch, so an SSID with quotes in it stays intact
	uci set "wireless.$s.ssid=$SSID"
done
uci commit

# guest DNS always goes to the router
cat > /etc/nftables.d/50-guest-dns.nft <<-'EOF'
chain dstnat_guest_dns {
	type nat hook prerouting priority dstnat; policy accept;
	iifname "br-guest" meta l4proto { tcp, udp } th dport 53 redirect to :53 comment "Force guest DNS to the router"
}
EOF

/etc/init.d/network reload
/etc/init.d/dnsmasq restart
fw4 check && /etc/init.d/firewall restart
echo "Guest network ready (SSID \"$SSID\", off until you turn it on from the page)."
