#!/bin/sh
# Installs the Speed Test page (LuCI -> Services -> Speed Test). Run on the
# router from this folder: sh install.sh
set -e
cd "$(dirname "$0")"

for c in curl nft; do
	command -v $c >/dev/null || { echo "missing: $c (apk add $c, or opkg install $c)"; exit 1; }
done

cp -r files/. /
chmod 755 /usr/bin/speedtest.sh /usr/libexec/rpcd/speedtest
# survive a sysupgrade
for f in /usr/bin/speedtest.sh /usr/lib/speedtest-busy.sh /usr/libexec/rpcd/speedtest \
	/usr/share/rpcd/acl.d/luci-app-speedtest.json /usr/share/luci/menu.d/luci-app-speedtest.json \
	/www/luci-static/resources/view/speedtest.js /root/speedtest.csv; do
	grep -qxF "$f" /etc/sysupgrade.conf || echo "$f" >> /etc/sysupgrade.conf
done

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Done. Reload LuCI and open Services -> Speed Test."
