#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Removes the Guest Wi-Fi page and its cron job, and turns guest Wi-Fi off.
#   sh uninstall.sh         keeps the guest network (it stays off)
#   sh uninstall.sh --all   also deletes the guest network, Wi-Fi, DHCP and firewall
#                           settings that setup.sh made

[ -x /usr/bin/guestwifi.sh ] && /usr/bin/guestwifi.sh power 0
sed -i '\#/usr/bin/guestwifi.sh#d' /etc/crontabs/root
/etc/init.d/cron restart

for f in /usr/bin/guestwifi.sh /usr/libexec/rpcd/guestwifi \
	/usr/share/rpcd/acl.d/luci-app-guestwifi.json /usr/share/luci/menu.d/luci-app-guestwifi.json \
	/www/luci-static/resources/view/guestwifi.js /www/luci-static/resources/guestwifi/qrcode.min.js \
	/etc/nftables.d/50-guest-dns.nft /etc/config/guestwifi; do
	[ "$1" = --all ] || [ "$f" != /etc/nftables.d/50-guest-dns.nft ] || continue
	rm -f "$f"
	sed -i "\#^$f\$#d" /etc/sysupgrade.conf
done
rmdir /www/luci-static/resources/guestwifi 2>/dev/null
rm -rf /var/run/guestwifi /var/run/guestwifi.*

if [ "$1" = --all ]; then
	for s in $(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)\.network='guest'$/\1/p"); do
		uci delete wireless.$s
	done
	for s in network.guest network.guest_dev dhcp.guest firewall.guest firewall.guest_wan \
		firewall.guest_dhcp firewall.guest_dns; do
		uci -q delete $s
	done
	uci commit
	wifi reload
	/etc/init.d/network reload
	/etc/init.d/dnsmasq restart
	/etc/init.d/firewall restart
fi

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Removed."
