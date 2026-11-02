#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Installs the Guest Wi-Fi page (LuCI -> Services -> Guest Wi-Fi) and its
# once-a-minute timer/data check. Run on the router from this folder:
#   sh install.sh ["Guest SSID"]
# Without a "guest" network it runs setup.sh first to make one.
set -e
cd "$(dirname "$0")"

missing=
command -v tc >/dev/null || missing="$missing tc-tiny"
for m in sch_cake ifb act_mirred cls_matchall; do
	find /lib/modules/$(uname -r) -name "$m.ko" | grep -q . || missing="$missing $m"
done
if [ -n "$missing" ]; then
	echo "missing:$missing"
	echo "install: apk add tc-tiny kmod-sched-core kmod-sched-cake kmod-ifb  (or opkg install ...)"
	exit 1
fi

uci -q get network.guest >/dev/null || sh ./setup.sh "${1:-Guest}"

cp -r files/. /
chmod 755 /usr/bin/guestwifi.sh /usr/libexec/rpcd/guestwifi

grep -qF '/usr/bin/guestwifi.sh tick' /etc/crontabs/root 2>/dev/null ||
	echo "* * * * * /usr/bin/guestwifi.sh tick" >> /etc/crontabs/root
/etc/init.d/cron enable
/etc/init.d/cron restart

# survive a sysupgrade
for f in /usr/bin/guestwifi.sh /usr/libexec/rpcd/guestwifi \
	/usr/share/rpcd/acl.d/luci-app-guestwifi.json /usr/share/luci/menu.d/luci-app-guestwifi.json \
	/www/luci-static/resources/view/guestwifi.js /www/luci-static/resources/guestwifi/qrcode.min.js \
	/etc/nftables.d/50-guest-dns.nft; do
	grep -qxF "$f" /etc/sysupgrade.conf || echo "$f" >> /etc/sysupgrade.conf
done

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Done. Reload LuCI and open Services -> Guest Wi-Fi."
