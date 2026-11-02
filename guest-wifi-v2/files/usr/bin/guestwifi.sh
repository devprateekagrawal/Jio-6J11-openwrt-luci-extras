#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Guest Wi-Fi, one QR per guest (LuCI page Services -> Guest Wi-Fi, and cron).
# Usage: guestwifi.sh power 1|0 | create <min> <mb> <mbps> <devs> [label]
#        | edit <id> <min> <mb> <mbps> <devs> [label] | cancel|revoke|extend|unlock <id>
#        | clear | tick | status
#   mb 0 = no data limit. Time starts when the first phone joins the pass.
# Each pass has its own 8-digit password and its own time/data/speed bucket, shared by
# up to <devs> phones. Only one pass is "open" at a time: its QR lets any new phone in,
# and a phone that joins is bound to that pass by MAC. When the pass is full, or after
# OPEN_MIN minutes, the QR stops working for new phones.
# The page controls every wifi-iface on network "guest" (each needs an ifname, e.g. guest5g).
# They must be WPA2-only: encryption psk2, wpa_psk_file /var/run/guestwifi.psk (install.sh
# sets both). Password file: "<mac> <key>", "00:00:00:00:00:00 <key>" for the open pass.
# When only this file changes, hostapd does "Update config data files for bss" plus
# RELOAD_WPA_PSK: no restart, and a phone is kept if its PMK still matches a line for its
# MAC or a wildcard, so binding and new QRs kick nobody.
# Not WPA3: an SAE phone's PMK never matches a PSK line, so every reload would kick all
# WPA3 guests once.
# The file must be readable by user "network" (hostapd), or hostapd restarts the whole
# radio and the home SSIDs drop for a few seconds.
# Settings (uci guestwifi.ui): cap = Mbps for all guests together (30), open_min = minutes
# an open QR takes new phones (15), view = wallet|dashboard (the page's look).
# Limits act on the guest AP interfaces, so flow offloading can't bypass them:
#   download - the APs' egress -> ifb "ifbguest", HTB: 1:1 = all guests (cap),
#              one class per pass (u32 ether dst), 1:2 = a phone not bound yet
#   upload   - nft "netdev guestwifi" ingress: one limit per pass + one for all guests
#   data     - per-phone rx+tx from "iw station dump", added to its pass every sync
# State is in /var/run/guestwifi/, so after a reboot guest is off and passes are gone.
SECTIONS=$(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)\.network='guest'$/\1/p")
DEVS=$(for s in $SECTIONS; do uci -q get wireless.$s.ifname; done)
FIRST=$(echo $SECTIONS | cut -d' ' -f1)
IFB=ifbguest
CAP=$(uci -q get guestwifi.ui.cap); case "$CAP" in ''|*[!0-9]*|0) CAP=30 ;; esac
OPEN_MIN=$(uci -q get guestwifi.ui.open_min); case "$OPEN_MIN" in ''|*[!0-9]*|0) OPEN_MIN=15 ;; esac
D=/var/run/guestwifi
PASSES=$D/passes   # "<id> <key> <min> <mb> <mbps> <devs> <made> <start> <used> <a|e> <why> <label>"
DEVF=$D/devs       # "<id> <mac> <last rx+tx counter>"
CUR=$D/cur         # "<id> <opened>" of the open pass
PSK=/var/run/guestwifi.psk
MB=1048576
now=$(date +%s)

log() { logger -t guestwifi "$*"; }
num() { case "$1" in ''|*[!0-9]*) echo 0 ;; *) echo "$1" ;; esac; }
clean() { printf %s "$1" | tr -cd 'A-Za-z0-9 ._-' | cut -c1-24; }

set_wifi() {   # $1 = 1 to disable, 0 to enable
	for s in $SECTIONS; do uci set wireless.$s.disabled=$1; done
	uci commit wireless
	wifi reload
}

up_devs() { for d in $DEVS; do [ -d /sys/class/net/$d ] && echo $d; done; }

kick() {   # $1 = mac; banned 5 s so it can't slip back in before its line is gone (apply runs
	# right after). Longer keeps a revoked guest out of a new QR too
	for d in $(up_devs); do
		ubus call hostapd.$d del_client "{\"addr\":\"$1\",\"deauth\":true,\"reason\":5,\"ban_time\":5000}" >/dev/null 2>&1
	done
}

stations() {   # "<mac> <rx+tx bytes> <band>" for every phone on the guest SSIDs
	for d in $(up_devs); do
		iw dev $d station dump 2>/dev/null | awk -v b=${d#guest} '
			/^Station/ { if (m) print m, n, b; m = $2; n = 0 }
			/(rx|tx) bytes:/ { n += $3 }
			END { if (m) print m, n, b }'
	done
}

load() {   # pass $1 -> $id $key $time $data $speed $devs $made $start $used $st $why $label
	id=
	awk -v i="$1" '$1 == i' $PASSES > $D/p
	read -r id key time data speed devs made start used st why label < $D/p
	[ -n "$id" ]
}

save() {   # write the loaded pass back (or add it)
	l="$id $key $time $data $speed $devs $made $start $used $st $why $label"
	awk -v i="$id" -v l="$l" '$1 == i { print l; d = 1; next } { print } END { if (!d) print l }' $PASSES > $PASSES.n
	mv $PASSES.n $PASSES
}

drop() {   # forget pass $1 and its phones
	awk -v i="$1" '$1 != i' $PASSES > $PASSES.n; mv $PASSES.n $PASSES
	awk -v i="$1" '$1 != i' $DEVF > $DEVF.n; mv $DEVF.n $DEVF
	[ "$(curid)" = "$1" ] && rm -f $CUR
}

ndevs() { awk -v i="$1" '$1 == i' $DEVF | wc -l; }
macs() { awk -v i="$1" '$1 == i { print $2 }' $DEVF; }
curid() { [ -s $CUR ] && cut -d' ' -f1 $CUR; }

reactivate() {   # an ended pass comes back if its limit was raised
	[ "$st" = e ] || return 0
	case "$why" in
		data) [ "$data" -eq 0 ] || [ "$used" -lt $(( data * MB )) ] || return 0 ;;
		time) [ "$start" -eq 0 ] || [ "$now" -lt $(( start + time * 60 )) ] || return 0 ;;
		*) return 0 ;;
	esac
	st=a; why=-
	log "pass $id back on (limit raised)"
}

end_pass() {   # $1 = id, $2 = why (revoked|time|data)
	load "$1" || return
	st=e; why=$2; save
	for m in $(macs "$1"); do kick $m; done
	[ "$(curid)" = "$1" ] && rm -f $CUR
	log "pass $1 ended: $2"
}

unlimit() {
	nft delete table netdev guestwifi 2>/dev/null
	for d in $DEVS; do tc qdisc del dev $d clsact 2>/dev/null; done
	ip link del $IFB 2>/dev/null
	rm -f $D/shape
}

limited() {   # are the hooks still on every guest interface? (a wifi restart drops them)
	for d in $(up_devs); do tc qdisc show dev $d | grep -q clsact || return 1; done
	nft list table netdev guestwifi >/dev/null 2>&1
}

shape() {   # rebuilt only when passes/phones/speeds changed or a hook went missing
	devs=$(up_devs)
	[ -n "$devs" ] || return 0
	sig=$(awk 'FILENAME == ARGV[1] { if ($10 == "a") s[$1] = $5; next } ($1 in s) { print $1, s[$1], $2 }' $PASSES $DEVF | sort | tr '\n' ' ')
	[ "$sig" = "$(cat $D/shape 2>/dev/null)" ] && limited && return 0
	unlimit
	ip link add $IFB type ifb && ip link set $IFB up
	tc qdisc add dev $IFB root handle 1: htb default 2
	tc class add dev $IFB parent 1: classid 1:1 htb rate ${CAP}mbit ceil ${CAP}mbit burst $(( CAP * 4 ))k cburst $(( CAP * 4 ))k quantum 1514
	tc class add dev $IFB parent 1:1 classid 1:2 htb rate 1mbit ceil 5mbit quantum 1514
	tc qdisc add dev $IFB parent 1:2 fq_codel
	rules=
	for p in $(awk '$10 == "a" { print $1 ":" $5 }' $PASSES); do
		i=${p%:*}; s=${p#*:}; m=$(macs $i)
		[ -n "$m" ] || continue
		cl=1:$(printf %x $(( i + 16 )))
		# +5% for the packet headers, as in devlog.sh
		b=$(( s * 4 )); [ $b -lt 16 ] && b=16
		tc class add dev $IFB parent 1:1 classid $cl htb rate $(( s * 1050 ))kbit ceil $(( s * 1050 ))kbit burst ${b}k cburst ${b}k quantum 1514
		tc qdisc add dev $IFB parent $cl fq_codel memory_limit 16Mb
		for x in $m; do tc filter add dev $IFB parent 1: protocol all prio 1 u32 match ether dst $x flowid $cl; done
		rate=$(( s * 125000 )); burst=$(( rate / 4 )); [ $burst -lt 65536 ] && burst=65536
		rules="$rules
		ether saddr { $(echo $m | sed 's/ /, /g') } limit rate over $rate bytes/second burst $burst bytes drop"
	done
	cap=$(( CAP * 125000 ))
	nft -f - <<-EOF
	table netdev guestwifi {
		chain up {
			type filter hook ingress devices = { $(echo $devs | sed 's/ /, /g') } priority -500; policy accept;$rules
			limit rate over $cap bytes/second burst $(( cap / 4 )) bytes drop
		}
	}
	EOF
	for d in $devs; do
		tc qdisc add dev $d clsact
		tc filter add dev $d egress matchall action mirred egress redirect dev $IFB
	done
	echo "$sig" > $D/shape
}

# hostapd runs as user "network": under rpcd (umask 077) new files are root-only
readable() { chgrp network "$@" 2>/dev/null; chmod 640 "$@"; }

apply() {   # password files from the passes; hostapd reloads only if they changed
	c=$(curid)
	{
		[ -n "$c" ] && awk -v c=$c '$1 == c && $10 == "a" { print "00:00:00:00:00:00 " $2 }' $PASSES
		awk 'FILENAME == ARGV[1] { if ($10 == "a") k[$1] = $2; next } ($1 in k) { print $2 " " k[$1] }' $PASSES $DEVF
	} > $PSK.n
	readable $PSK.n
	if cmp -s $PSK.n $PSK; then
		rm -f $PSK.n
	else
		mv $PSK.n $PSK
		[ -n "$(up_devs)" ] && ubus call hostapd reload >/dev/null 2>&1
	fi
	shape
}

sync() {   # count data, bind new phones to the open pass, end passes that ran out
	[ -f $D/on ] || return 0
	stations > $D/st
	# a phone of an ended pass that is connected again can only have used the open QR:
	# forget its old pass, so it is treated as new below
	awk 'FILENAME == ARGV[1] { if ($10 == "e") e[$1]; next } FILENAME == ARGV[2] { on[$1]; next }
		!(($1 in e) && ($2 in on))' $PASSES $D/st $DEVF > $DEVF.n
	mv $DEVF.n $DEVF
	# data: delta of each known phone's counter (a reconnect restarts it from 0)
	awk -v A=$D/add 'FILENAME == ARGV[1] { t[$1] = $2; next }
		($2 in t) { x = t[$2]; add[$1] += x >= $3 ? x - $3 : x; $3 = x }
		{ print }
		END { for (i in add) print i, add[i] > A }' $D/st $DEVF > $DEVF.n
	mv $DEVF.n $DEVF
	if [ -s $D/add ]; then
		awk 'FILENAME == ARGV[1] { a[$1] = $2; next } ($1 in a) { $9 += a[$1] } { print }' $D/add $PASSES > $PASSES.n
		mv $PASSES.n $PASSES
	fi
	rm -f $D/add
	# new phones: only the open pass's wildcard line can have let them in
	awk 'FILENAME == ARGV[1] { k[$2]; next } !($1 in k) { print $1, $2 }' $DEVF $D/st | while read -r m n; do
		c=$(curid)
		if [ -n "$c" ] && load $c && [ "$st" = a ] && [ $(ndevs $c) -lt $devs ]; then
			echo "$c $m $n" >> $DEVF
			used=$(( used + n )); [ "$start" -gt 0 ] || start=$now; save
			k=$(ndevs $c)
			log "pass $c: phone $m joined ($k/$devs)"
			[ $k -ge $devs ] && rm -f $CUR
		else
			kick $m
			log "phone $m on guest Wi-Fi without a free pass -> kicked"
		fi
	done
	# limits
	for x in $(awk -v n=$now -v MB=$MB '$10 == "a" {
			if ($4 > 0 && $9 >= $4 * MB) print $1 ":data"
			else if ($8 > 0 && n >= $8 + $3 * 60) print $1 ":time" }' $PASSES); do
		end_pass ${x%:*} ${x#*:}
	done
	# an open QR closes after OPEN_MIN; a pass nobody used is deleted
	if [ -s $CUR ]; then
		read -r c o < $CUR
		if [ $(( now - o )) -ge $(( OPEN_MIN * 60 )) ]; then
			rm -f $CUR
			if [ $(ndevs $c) -eq 0 ]; then drop $c; log "pass $c: QR not used in $OPEN_MIN min, deleted"
			else log "pass $c: QR closed for new phones"; fi
		fi
	fi
	apply
}

power() {   # $1 = 1 on / 0 off, $2 = why (off)
	if [ "$1" = 1 ]; then
		[ -f $D/on ] && return
		mkdir -p $D; : > $PASSES; : > $DEVF; rm -f $CUR $D/shape
		: > $PSK; readable $PSK
		touch $D/on
		set_wifi 0
		for i in $(seq 1 20); do [ "$(up_devs | wc -l)" -eq $(echo $DEVS | wc -w) ] && break; sleep 1; done
		for d in $(up_devs); do echo 1 > /sys/class/net/$d/brport/isolated; done
		apply
		log "on"
	else
		rm -rf $D
		: > $PSK; readable $PSK
		unlimit
		set_wifi 1
		log "off${2:+: $2}"
	fi
}

create() {   # <min> <mb> <mbps> <devs> [label]
	[ -f $D/on ] || return 1
	c=$(curid)
	if [ -n "$c" ]; then
		rm -f $CUR
		[ $(ndevs $c) -eq 0 ] && { drop $c; log "pass $c: replaced before anyone used it"; }
	fi
	n=$(( $(cat $D/seq 2>/dev/null || echo 0) + 1 )); echo $n > $D/seq
	while :; do
		key=$(tr -dc 1-9 </dev/urandom | head -c 1)$(tr -dc 0-9 </dev/urandom | head -c 7)
		awk -v k=$key '$2 == k { f = 1 } END { exit !f }' $PASSES || break
	done
	id=$n time=$(num "$1") data=$(num "$2") speed=$(num "$3") devs=$(num "$4")
	[ "$time" -gt 0 ] || time=180; [ "$speed" -gt 0 ] || speed=10; [ "$devs" -gt 0 ] || devs=1
	made=$now start=0 used=0 st=a why=- label=$(clean "$5")
	save
	echo "$id $now" > $CUR
	log "pass $id created: ${time}m, ${data}MB, ${speed}Mbps, $devs phone(s)"
	apply
}

edit() {   # <id> <min> <mb> <mbps> <devs> [label]
	load "$1" || return 1
	t=$(num "$2"); [ "$t" -gt 0 ] && time=$t
	data=$(num "$3")
	s=$(num "$4"); [ "$s" -gt 0 ] && speed=$s
	n=$(num "$5"); k=$(ndevs $id); [ "$n" -lt "$k" ] && n=$k; [ "$n" -gt 0 ] && devs=$n
	label=$(clean "$6")
	reactivate; save
	log "pass $id edited: ${time}m, ${data}MB, ${speed}Mbps, $devs phone(s)"
	apply
}

extend() {
	load "$1" || return 1
	time=$(( time + 60 )); reactivate; save
	log "pass $id: +1 hour"
	apply
}

cancel() {   # only a pass no phone has joined yet
	load "$1" && [ $(ndevs $1) -eq 0 ] || return 1
	drop $1; log "pass $1: QR cancelled"
	apply
}

revoke() { end_pass "$1" revoked; apply; }

unlock() {   # open the pass's QR again: phones not connected now are forgotten (new MAC), time/data kept
	load "$1" && [ "$st" = a ] || return 1
	c=$(curid)
	[ -n "$c" ] && [ "$c" != "$1" ] && [ $(ndevs $c) -eq 0 ] && { drop $c; log "pass $c: replaced by unlock of pass $1"; }
	stations > $D/st
	awk -v i="$1" 'FILENAME == ARGV[1] { on[$1]; next } $1 != i || ($2 in on)' $D/st $DEVF > $DEVF.n
	mv $DEVF.n $DEVF
	echo "$1 $now" > $CUR
	log "pass $1 open again for new phones"
	apply
}

clear() {
	for i in $(awk '$10 == "e" { print $1 }' $PASSES); do drop $i; done
	apply
}

tick() {
	if [ ! -f $D/on ]; then
		# after a reboot the guest SSIDs must not come up without passes and limits
		for s in $SECTIONS; do
			[ "$(uci -q get wireless.$s.disabled)" = 0 ] && { power 0 "no state (reboot?)"; return; }
		done
		return
	fi
	for d in $(up_devs); do echo 1 > /sys/class/net/$d/brport/isolated; done
	sync
}

status() {
	[ -f $D/on ] && on=true || on=false
	L=/tmp/dhcp.leases; [ -f $L ] || L=/dev/null
	ST=$D/st; [ -f $ST ] || ST=/dev/null
	c=0 o=0; [ -s $CUR ] && read -r c o < $CUR
	view=$(uci -q get guestwifi.ui.view)
	printf '{"on":%s,"now":%s,"cap":%s,"open_min":%s,"view":"%s","cur":%s,"cur_opened":%s,"ssid":"%s","passes":[' \
		$on $now $CAP $OPEN_MIN "${view:-wallet}" $c $o "$(uci -q get wireless.$FIRST.ssid | sed 's/["\\]/\\&/g')"
	[ -f $PASSES ] && awk '
		function clean(s) { gsub(/[^A-Za-z0-9 ._-]/, "", s); return s }
		FILENAME == ARGV[1] { if ($4 != "*") nm[$2] = $4; next }
		FILENAME == ARGV[2] { bd[$1] = $3; next }
		FILENAME == ARGV[3] {
			dv[$1] = dv[$1] (dv[$1] != "" ? "," : "") sprintf("{\"mac\":\"%s\",\"name\":\"%s\",\"online\":%s,\"band\":\"%s\"}",
				$2, clean(nm[$2]), ($2 in bd) ? "true" : "false", bd[$2])
			next
		}
		{
			label = ""; for (j = 12; j <= NF; j++) label = label (j > 12 ? " " : "") $j
			printf "%s{\"id\":%s,\"key\":\"%s\",\"time\":%s,\"data\":%s,\"speed\":%s,\"devs\":%s,\"made\":%s,\"start\":%s,\"used\":%s,\"state\":\"%s\",\"why\":\"%s\",\"label\":\"%s\",\"devices\":[%s]}",
				(n++ ? "," : ""), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clean(label), dv[$1]
		}' $L $ST $DEVF $PASSES
	printf ']}\n'
}

[ -n "$SECTIONS" ] || { echo "no wifi-iface on network \"guest\" (run setup.sh)"; exit 1; }
lock /var/lock/guestwifi
trap 'lock -u /var/lock/guestwifi' EXIT
case "$1" in
	power) power "$2" ;;
	off) power 0 ;;   # v1 name, so v1's uninstall.sh still works
	create) create "$2" "$3" "$4" "$5" "$6" ;;
	edit) edit "$2" "$3" "$4" "$5" "$6" "$7" ;;
	cancel|revoke|extend|unlock) [ -f $D/on ] && "$1" "$(num "$2")" ;;
	clear) [ -f $D/on ] && clear ;;
	tick) tick ;;
	status) sync; status ;;
	*) echo "usage: $0 power 1|0 | create <min> <mb> <mbps> <devs> [label] | edit <id> <min> <mb> <mbps> <devs> [label] | cancel|revoke|extend|unlock <id> | clear | tick | status"; exit 1 ;;
esac
