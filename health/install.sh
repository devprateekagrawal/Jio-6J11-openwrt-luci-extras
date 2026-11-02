#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Installs the Health page (LuCI -> Services -> Health) and its once-a-minute
# sampler. Run on the router from this folder: sh install.sh
# Your list of watched services (/etc/health.services) is kept if it exists.
set -e
cd "$(dirname "$0")"

cp -r files/. /
chmod 755 /usr/bin/health.sh /usr/libexec/rpcd/health

# the services to watch: the usual daemons, plus this repo's pages if installed
if [ ! -f /etc/health.services ]; then
	{
		cat <<-'EOF'
		# Services the Health page watches, one per line:
		#   name|kind|match|max age (s)|label|description|file
		# kind ps:   up while a process whose command line contains <match> runs
		#            (see `ps w`); max age and file are unused.
		# kind cron: a cron job. Off if <match> isn't in /etc/crontabs/root, up if
		#            <file> (default /var/lock/<name>) changed in the last <max age>
		#            seconds. Pick a file the job touches on every run (its lock
		#            file, log or output) and a max age a bit over its interval.
		# Changes apply on the next sample (within a minute).
		dnsmasq|ps|/usr/sbin/dnsmasq|0|dnsmasq|DHCP and DNS for the LAN
		crond|ps|/usr/sbin/crond|0|cron|runs the cron jobs, this page's sampler too
		EOF
		[ -x /usr/sbin/odhcpd ] && echo 'odhcpd|ps|/usr/sbin/odhcpd|0|odhcpd|IPv6 router advertisements and DHCPv6'
		[ -x /usr/sbin/uhttpd ] && echo 'uhttpd|ps|/usr/sbin/uhttpd|0|LuCI web server|uhttpd'
		command -v tayga >/dev/null && echo 'tayga|ps|tayga|0|CLAT (tayga)|IPv4 over an IPv6-only uplink'
		[ -x /usr/bin/devlog.sh ] && echo 'devlog|cron|/usr/bin/devlog.sh|150|Device Usage|devlog.sh, every minute'
		[ -x /usr/bin/guestwifi.sh ] && echo 'guestwifi|cron|/usr/bin/guestwifi.sh|150|Guest Wi-Fi timer|guestwifi.sh, every minute'
		true
	} > /etc/health.services
	echo "Watching: $(grep -v '^#' /etc/health.services | cut -d'|' -f1 | tr '\n' ' ')(edit /etc/health.services to change)"
fi

grep -qF /usr/bin/health.sh /etc/crontabs/root 2>/dev/null ||
	echo "* * * * * /usr/bin/health.sh" >> /etc/crontabs/root
/etc/init.d/cron enable
/etc/init.d/cron restart

# survive a sysupgrade (service list, events and daily summary too)
for f in /usr/bin/health.sh /usr/libexec/rpcd/health \
	/usr/share/rpcd/acl.d/luci-app-health.json /usr/share/luci/menu.d/luci-app-health.json \
	/www/luci-static/resources/view/health.js /etc/health.services /etc/health.hook \
	/root/health.events /root/health-daily.csv; do
	grep -qxF "$f" /etc/sysupgrade.conf || echo "$f" >> /etc/sysupgrade.conf
done

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Done. Reload LuCI and open Services -> Health (the first data shows after a minute, CPU after two)."
