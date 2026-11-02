#!/bin/sh
# Removes the Health page, its sampler, its service list, hook and history.
# Run on the router: sh uninstall.sh

sed -i '\#/usr/bin/health.sh#d' /etc/crontabs/root
/etc/init.d/cron restart

for f in /usr/bin/health.sh /usr/libexec/rpcd/health \
	/usr/share/rpcd/acl.d/luci-app-health.json /usr/share/luci/menu.d/luci-app-health.json \
	/www/luci-static/resources/view/health.js /etc/health.services /etc/health.hook \
	/root/health.events /root/health-daily.csv; do
	rm -f "$f"
	sed -i "\#^$f\$#d" /etc/sysupgrade.conf
done
rm -f /tmp/health.*

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Removed."
