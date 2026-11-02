#!/bin/sh
# Installs the Guest Wi-Fi page (LuCI -> Services -> Guest Wi-Fi, one QR per guest)
# and its once-a-minute time/data check. Run on the router from this folder:
#   sh install.sh ["Guest SSID"]
# Works on a fresh router and as an upgrade from v1 (guest-wifi/): v1 is turned off and
# its files are replaced under the same names. Without a "guest" network it runs
# setup.sh first to make one. Every wifi-iface on
# network "guest" is switched to WPA2 with a per-guest password file (see guestwifi.sh).
set -e
cd "$(dirname "$0")"

missing=
command -v tc >/dev/null || missing="$missing tc-tiny"
for m in sch_htb cls_u32 ifb act_mirred cls_matchall; do
	find /lib/modules/$(uname -r) -name "$m.ko" | grep -q . || missing="$missing $m"
done
if [ -n "$missing" ]; then
	echo "missing:$missing"
	echo "install: apk add tc-tiny kmod-sched-core kmod-ifb  (or opkg install ...)"
	exit 1
fi

# version 1 (one password for everyone) used "off"; turn it off before replacing it
[ -f /var/run/guestwifi.state ] && [ -x /usr/bin/guestwifi.sh ] && /usr/bin/guestwifi.sh off
rm -f /var/run/guestwifi.state /var/run/guestwifi.bytes

uci -q get network.guest >/dev/null || sh ./setup.sh "${1:-Guest}"

# WPA2 with the password file, off until turned on from the page. PMF (ieee80211w)
# is left off: with it, phones got "PSK mismatch" on 2.4 GHz
key=$(tr -dc 'a-km-np-zA-HJ-NP-Z2-9' </dev/urandom | head -c 24)   # never shown; guests get per-pass keys
for s in $(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)\.network='guest'$/\1/p"); do
	[ -n "$(uci -q get wireless.$s.ifname)" ] ||
		uci set wireless.$s.ifname="guest$(uci -q get wireless.$(uci get wireless.$s.device).band)"
	uci set wireless.$s.encryption='psk2'
	uci set wireless.$s.key="$key"
	uci set wireless.$s.wpa_psk_file='/var/run/guestwifi.psk'
	uci set wireless.$s.disabled='1'
	for o in ieee80211w sae_password_file sae_pwe; do uci -q delete wireless.$s.$o || true; done
done
uci commit wireless
[ -f /etc/config/guestwifi ] ||
	printf "config ui 'ui'\n\toption view 'wallet'\n\toption cap '30'\n\toption open_min '15'\n" > /etc/config/guestwifi

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
	/etc/nftables.d/50-guest-dns.nft /etc/config/guestwifi; do
	grep -qxF "$f" /etc/sysupgrade.conf || echo "$f" >> /etc/sysupgrade.conf
done

/etc/init.d/rpcd restart
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
echo "Done. Reload LuCI and open Services -> Guest Wi-Fi."
