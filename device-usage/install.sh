#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Installs the Device Usage page (LuCI -> Services -> Device Usage) and its
# once-a-minute logger. Run on the router from this folder: sh install.sh
set -e
cd "$(dirname "$0")"

command -v iw >/dev/null || { echo "missing: iw (apk add iw, or opkg install iw)"; exit 1; }
command -v tc >/dev/null || echo "note: no tc, so speed limits won't work (apk add tc-tiny kmod-sched-core)"

cp -r files/. /
chmod 755 /usr/bin/devlog.sh /usr/libexec/rpcd/devlog

grep -qF /usr/bin/devlog.sh /etc/crontabs/root 2>/dev/null ||
	echo "* * * * * /usr/bin/devlog.sh" >> /etc/crontabs/root
/etc/init.d/cron enable
/etc/init.d/cron restart

# survive a sysupgrade (history and limits too)
for f in /usr/bin/devlog.sh /usr/libexec/rpcd/devlog \
	/usr/share/rpcd/acl.d/luci-app-devlog.json /usr/share/luci/menu.d/luci-app-devlog.json \
	/www/luci-static/resources/view/devlog.js /root/devlog.csv /root/devlog.names /etc/devlog.limits; do
	grep -qxF "$f" /etc/sysupgrade.conf || echo "$f" >> /etc/sysupgrade.conf
done

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Done. Reload LuCI and open Services -> Device Usage (the first data shows after a minute)."
