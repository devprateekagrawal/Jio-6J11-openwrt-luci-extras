#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Guest Wi-Fi control (used by the LuCI page Services -> Guest Wi-Fi and by cron).
# Usage: guestwifi.sh on <minutes> <data_mb> <speed_mbps> | off | tick | status | newpass
#   minutes: 0 = no timer, -1 = until midnight; data_mb / speed_mbps: 0 = no limit
# Guest SSIDs: every wifi-iface on network "guest" (setup.sh makes one per radio,
# ifnames guest2g/guest5g/...; firewall zone guest -> wan only). Limits act on the
# guest AP interfaces themselves, so flow offloading cannot bypass them, and are
# shared by all guests:
#   upload   - nft netdev ingress policer (table "netdev guestwifi")
#   download - the APs' egress redirected to ifb "ifbguest" with cake on it
#   data     - AP interface byte counters, checked every minute by cron (tick)
SECTIONS=$(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)\.network='guest'$/\1/p")
DEVS=$(for s in $SECTIONS; do uci -q get wireless.$s.ifname; done)
FIRST=$(echo $SECTIONS | cut -d' ' -f1)
IFB=ifbguest
STATE=/var/run/guestwifi.state   # "<expires> <data_mb> <speed_mbps> <since>"
BYTES=/var/run/guestwifi.bytes   # "<counted> <last counter sum>"

log() { logger -t guestwifi "$*"; }
num() { case "$1" in ''|*[!0-9-]*) echo 0 ;; *) echo "$1" ;; esac; }

set_wifi() {   # $1 = 1 to disable, 0 to enable
	for s in $SECTIONS; do uci set wireless.$s.disabled=$1; done
	uci commit wireless
	wifi reload
}

up_devs() { for d in $DEVS; do [ -d /sys/class/net/$d ] && echo $d; done; }

unlimit() {
	nft delete table netdev guestwifi 2>/dev/null
	for d in $DEVS; do tc qdisc del dev $d clsact 2>/dev/null; done
	ip link del $IFB 2>/dev/null
}

limit() {   # $1 = Mbps (0 = none)
	unlimit
	[ "$1" -gt 0 ] || return 0
	devs=$(up_devs)
	[ -n "$devs" ] || return 1
	rate=$(( $1 * 125000 )); burst=$(( rate / 4 )); [ $burst -lt 65536 ] && burst=65536
	nft -f - <<-EOF
	table netdev guestwifi {
		chain up {
			type filter hook ingress devices = { $(echo $devs | sed 's/ /, /g') } priority -500; policy accept;
			limit rate over $rate bytes/second burst $burst bytes drop
		}
	}
	EOF
	lsmod | grep -q '^sch_cake' || insmod sch_cake
	ip link add $IFB type ifb && ip link set $IFB up
	tc qdisc add dev $IFB root cake bandwidth ${1}mbit besteffort
	for d in $devs; do
		tc qdisc add dev $d clsact
		tc filter add dev $d egress matchall action mirred egress redirect dev $IFB
	done
}

limited() {   # are the hooks still on every guest interface? (a wifi restart drops them)
	for d in $(up_devs); do tc qdisc show dev $d | grep -q clsact || return 1; done
	nft list table netdev guestwifi >/dev/null 2>&1
}

counter() {   # sum of rx+tx bytes on the guest interfaces right now
	s=0
	for d in $(up_devs); do
		s=$(( s + $(cat /sys/class/net/$d/statistics/rx_bytes) + $(cat /sys/class/net/$d/statistics/tx_bytes) ))
	done
	echo $s
}

used() {   # bytes since "on"; $1 = save to keep the running total across interface restarts
	cur=$(counter); read n last < $BYTES 2>/dev/null
	[ "${last:-0}" -le "$cur" ] && n=$(( ${n:-0} + cur - ${last:-0} )) || n=$(( ${n:-0} + cur ))
	[ "$1" = save ] && echo "$n $cur" > $BYTES
	echo $n
}

on() {
	min=$(num "$1"); mb=$(num "$2"); mbps=$(num "$3")
	now=$(date +%s)
	case "$min" in
		-1) set -- $(date '+%H %M %S')
		    exp=$(( now + 86400 - ${1#0} * 3600 - ${2#0} * 60 - ${3#0} )) ;;
		0|-*) exp=0 ;;
		*) exp=$(( now + min * 60 )) ;;
	esac
	echo "$exp $mb $mbps $now" > $STATE
	set_wifi 0
	for i in $(seq 1 20); do [ "$(up_devs | wc -l)" -eq "$(echo $DEVS | wc -w)" ] && break; sleep 1; done
	for d in $(up_devs); do echo 1 > /sys/class/net/$d/brport/isolated; done
	limit $mbps
	echo "0 $(counter)" > $BYTES
	log "on: timer ${min}m, data ${mb}MB, speed ${mbps}Mbps"
}

off() {
	rm -f $STATE $BYTES
	unlimit
	set_wifi 1
	log "off${1:+: $1}"
}

tick() {
	if [ ! -f $STATE ]; then
		# after a reboot the guest SSIDs must not come up without timer/limits
		for s in $SECTIONS; do
			[ "$(uci -q get wireless.$s.disabled)" = 0 ] && { off "no state (reboot?)"; return; }
		done
		return
	fi
	read exp mb mbps since < $STATE
	[ "$exp" -gt 0 ] && [ "$(date +%s)" -ge "$exp" ] && { off "timer over"; return; }
	u=$(used save)
	[ "$mb" -gt 0 ] && [ "$u" -ge $(( mb * 1048576 )) ] && { off "data limit ${mb}MB used"; return; }
	if [ "$mbps" -gt 0 ] && ! limited; then
		for d in $(up_devs); do echo 1 > /sys/class/net/$d/brport/isolated; done
		limit $mbps
	fi
}

newpass() {
	key=$(tr -dc 'a-km-np-zA-HJ-NP-Z2-9' </dev/urandom | head -c 10)
	for s in $SECTIONS; do uci set wireless.$s.key="$key"; done
	uci commit wireless
	[ -f $STATE ] && wifi reload
	log "new password set"
}

status() {
	now=$(date +%s)
	if [ -f $STATE ]; then read exp mb mbps since < $STATE; on=true; u=$(used); else exp=0 mb=0 mbps=0 since=0 on=false u=0; fi
	rem=0; [ "$exp" -gt 0 ] && rem=$(( exp - now )) && [ $rem -lt 0 ] && rem=0
	printf '{"on":%s,"expires":%s,"remaining":%s,"since":%s,"data_mb":%s,"speed_mbps":%s,"used":%s,' \
		$on $exp $rem $since $mb $mbps $u
	printf '"ssid":"%s","key":"%s","clients":[' \
		"$(uci -q get wireless.$FIRST.ssid | sed 's/["\\]/\\&/g')" "$(uci -q get wireless.$FIRST.key)"
	first=1
	for d in $(up_devs); do
		for mac in $(iw dev $d station dump 2>/dev/null | awk '/^Station/{print $2}'); do
			set -- $(awk -v m="$mac" '$2==m{print $3, $4}' /tmp/dhcp.leases)
			[ $first = 1 ] || printf ','; first=0
			printf '{"mac":"%s","ip":"%s","name":"%s","band":"%s"}' "$mac" "$1" "${2#\*}" "${d#guest}"
		done
	done
	printf ']}\n'
}

lock /var/lock/guestwifi
trap 'lock -u /var/lock/guestwifi' EXIT
case "$1" in
	on) on "$2" "$3" "$4" ;;
	off) off "manual" ;;
	tick) tick ;;
	status) status ;;
	newpass) newpass ;;
	*) echo "usage: $0 on <minutes> <data_mb> <speed_mbps> | off | tick | status | newpass"; exit 1 ;;
esac
