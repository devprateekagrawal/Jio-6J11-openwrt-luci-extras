#!/bin/sh
# Removes the Device Usage page, its logger, its speed limits and its history.
# Run on the router: sh uninstall.sh

sed -i '\#/usr/bin/devlog.sh#d' /etc/crontabs/root
/etc/init.d/cron restart

# take the speed limits off the access points
if [ -x /usr/bin/devlog.sh ]; then
	rm -f /etc/devlog.limits
	/usr/bin/devlog.sh apply
fi

for f in /usr/bin/devlog.sh /usr/libexec/rpcd/devlog \
	/usr/share/rpcd/acl.d/luci-app-devlog.json /usr/share/luci/menu.d/luci-app-devlog.json \
	/www/luci-static/resources/view/devlog.js /root/devlog.csv /root/devlog.names /etc/devlog.limits; do
	rm -f "$f"
	sed -i "\#^$f\$#d" /etc/sysupgrade.conf
done
rm -f /tmp/devlog.*

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Removed."
