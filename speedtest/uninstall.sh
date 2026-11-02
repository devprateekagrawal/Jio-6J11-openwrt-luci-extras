#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Removes the Speed Test page and its history. Run on the router: sh uninstall.sh

/usr/bin/speedtest.sh stop 2>/dev/null
nft delete table inet speedtest 2>/dev/null

for f in /usr/bin/speedtest.sh /usr/lib/speedtest-busy.sh /usr/libexec/rpcd/speedtest \
	/usr/share/rpcd/acl.d/luci-app-speedtest.json /usr/share/luci/menu.d/luci-app-speedtest.json \
	/www/luci-static/resources/view/speedtest.js /root/speedtest.csv; do
	rm -f "$f"
	sed -i "\#^$f\$#d" /etc/sysupgrade.conf
done
rm -rf /tmp/speedtest /tmp/speedtest.pid

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Removed."
