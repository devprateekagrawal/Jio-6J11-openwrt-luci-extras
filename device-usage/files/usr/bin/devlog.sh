#!/bin/sh
# Device usage: how fast each Wi-Fi device downloads, minute by minute (say the
# TV on a 4K stream), to know what speed limit per device would still be enough.
# Cron runs it every minute. It reads the access points' per-device byte
# counters (iw station dump) every 10 s; those count even with hardware flow
# offloading, which hides the traffic from nftables counters. Each minute, a
# device that moved at least MIN Mbps is written as
#   <epoch>,<mac>,<down Mbps>,<down peak Mbps>,<up Mbps>
# down/up = the minute's average, peak = its fastest 10 s. It is Wi-Fi traffic,
# so casting from a phone on the LAN to the TV counts too.
# Rows go to RAM and once an hour to flash, to spare it.
#
# Speed limits: per device (MAC), download only. An HTB class with that rate on
# every access point's egress, matched by destination MAC; everything else goes
# through HTB's direct queue, unshaped. The qdisc still sees flows that the
# flowtable offloads (software offload transmits through it). With no limit on,
# the APs are left with no qdisc at all, as before. Each cron run re-applies it
# if a Wi-Fi restart dropped it.
#
# Usage: devlog.sh                 one minute of readings, in the background (cron)
#        devlog.sh rows <h> [mac]  rows of the last h hours; if h > 48 one per
#                                  hour: ts,mac,down,peak,up,in-use min,max min
#        devlog.sh sums <h>        mac,in-use min,median,p95,max min,peak,MB down
#        devlog.sh sum <h> <mac>   the same for one device, without the mac
#        devlog.sh devs <h>        "mac,name,MB down" of the devices seen, most first
#        devlog.sh now             live: rows of the last 10 s, peak = down (all devices)
#        devlog.sh lims            "mac,on,Mbps" of every device given a limit
#        devlog.sh limit <mac> <0|1> <Mbps>   set a limit off / on (1-1000 Mbps)
#        devlog.sh apply           (re)apply the limits to the access points

NEW=/tmp/devlog.new
LOG=/root/devlog.csv
SNAP=/tmp/devlog.snap      # "<cs> <mac> <tx> <rx>" of the last reading
LAST=/tmp/devlog.last      # the same for the last two readings (live speed)
NAMES=/root/devlog.names   # "<mac> <name>", so names outlive the DHCP lease
LIM=/etc/devlog.limits     # "<mac> <on 0|1> <Mbps>"; off keeps the number for next time
KEEP=200000                # ~9 MB, months of a few busy devices
MIN=0.1                    # Mbps; quieter minutes are not written
USE=1                      # Mbps; a minute at least this fast counts as "in use"

now_cs() { awk '{ printf "%d", $1 * 100 }' /proc/uptime; }
aps() { iw dev | awk '$1 == "Interface" { i = $2 } $1 == "type" && $2 == "AP" { print i }'; }

# one reading of every station on the access points: "<cs> <mac> <tx> <rx>"
# (tx = sent to the device = its download)
snap() {
	t=$(now_cs)
	for i in $(aps); do
		iw dev $i station dump
	done | awk -v t=$t '
		$1 == "Station" { m = $2 }
		$1 == "rx" && $2 == "bytes:" { rx[m] = $3 }
		$1 == "tx" && $2 == "bytes:" { tx[m] = $3 }
		END { for (m in tx) print t, m, tx[m], rx[m] }'
}

sample() {
	w=/tmp/devlog.win
	: > $w
	# the previous run's last reading starts this minute, unless cron missed a run
	read t0 rest 2>/dev/null < $SNAP && [ $(( $(now_cs) - t0 )) -lt 12000 ] && cat $SNAP > $w
	for i in 1 2 3 4 5 6; do
		[ $i -gt 1 ] && sleep 10
		snap >> $w
	done
	awk -v now=$(date +%s) -v min=$MIN '
		{
			m = $2
			if (m in tl) {
				dt = ($1 - tl[m]) / 100
				d = $3 - xl[m]; if (d < 0) d = $3   # counter restarted: it reconnected
				u = $4 - rl[m]; if (u < 0) u = $4
				D[m] += d; U[m] += u; T[m] += dt
				if (dt > 0 && d * 8 / dt / 1e6 > pk[m]) pk[m] = d * 8 / dt / 1e6
			}
			tl[m] = $1; xl[m] = $3; rl[m] = $4
		}
		END {
			for (m in T) if (T[m] > 0) {
				dn = D[m] * 8 / T[m] / 1e6; up = U[m] * 8 / T[m] / 1e6
				if (dn >= min || up >= min) printf "%d,%s,%.1f,%.1f,%.1f\n", now, m, dn, pk[m], up
			}
		}' $w >> $NEW
	t=$(tail -n 1 $w | cut -d' ' -f1)
	grep "^$t " $w > $SNAP
	# the last two readings, for the live speed until the next run's first ones
	t0=$(cut -d' ' -f1 $w | uniq | tail -n 2 | head -n 1)
	awk -v t=$t0 '$1 >= t' $w > $LAST
	rm -f $w
}

# move the minute rows from RAM to flash once an hour, keep KEEP; remember names
flush() {
	{ cat $NAMES 2>/dev/null; awk '$4 != "*" { print $2, $4 }' /tmp/dhcp.leases; } |
		awk '{ n[$1] = $2 } END { for (m in n) print m, n[m] }' > $NAMES.tmp && mv $NAMES.tmp $NAMES
	[ -s $NEW ] || return
	cat $NEW >> $LOG && rm -f $NEW
	[ $(wc -l < $LOG) -gt $((KEEP + 2000)) ] && { tail -n $KEEP $LOG > $LOG.tmp && mv $LOG.tmp $LOG; }
}

from() { echo $(( $(date +%s) - $1 * 3600 )); }

rows() {
	cat $LOG $NEW 2>/dev/null | awk -F, -v from=$(from $1) -v mac="$2" -v use=$USE -v hourly=$([ $1 -gt 48 ] && echo 1 || echo 0) '
		$1 < from || (mac != "" && $2 != mac) { next }
		!hourly { print; next }
		{
			k = int($1 / 3600) * 3600 "," $2
			n[k]++; up[k] += $5
			if ($3 >= use) { s[k] += $3; c[k]++ }
			if ($3 > mx[k]) mx[k] = $3
			if ($4 > pk[k]) pk[k] = $4
		}
		END { for (k in n) printf "%s,%.1f,%.1f,%.1f,%d,%.1f\n", k, c[k] ? s[k] / c[k] : 0, pk[k], up[k] / n[k], c[k], mx[k] }' | sort -n
}

# per device: its in-use minutes sorted by speed, after a "-1 <peak> <MB>" line
# (which sorts first), give median and 95th percentile
sums() {
	cat $LOG $NEW 2>/dev/null | awk -F, -v from=$(from $1) -v use=$USE '
		$1 >= from { mb[$2] += $3 * 7.5; if ($4 > pk[$2]) pk[$2] = $4; if ($3 >= use) print $2, $3 }
		END { for (m in mb) printf "%s -1 %.1f %.0f\n", m, pk[m], mb[m] }' | sort -k1,1 -k2,2n | awk '
		function out(  i, j) {
			if (m == "") return
			i = int((n + 1) / 2); j = int(n * .95); if (j < n * .95) j++
			printf "%s,%d,%s,%s,%s,%s,%s\n", m, n, n ? v[i] : 0, n ? v[j] : 0, n ? v[n] : 0, pk, mb
		}
		$1 != m { out(); m = $1; n = 0 }
		$2 == -1 { pk = $3; mb = $4; next }
		{ v[++n] = $2 }
		END { out() }'
}

# speed over the last 10 s, from the two newest readings the minute's run took
# (its file, or between runs the last two it kept); nothing if they are older
# than 30 s, so a stopped logger doesn't show an old speed as live
live() {
	cat $LAST /tmp/devlog.win 2>/dev/null | awk -v now=$(date +%s) -v cs=$(now_cs) -v min=$MIN '
		$1 > t1 { t0 = t1; t1 = $1 } $1 < t1 && $1 > t0 { t0 = $1 }
		{ x[$1, $2] = $3; r[$1, $2] = $4; m[$2] }
		END {
			if (!t0 || cs - t1 > 3000) exit
			dt = (t1 - t0) / 100
			for (k in m) if ((t0, k) in x && (t1, k) in x) {
				d = x[t1, k] - x[t0, k]; u = r[t1, k] - r[t0, k]
				if (d < 0 || u < 0) continue
				dn = d * 8 / dt / 1e6; up = u * 8 / dt / 1e6
				if (dn >= min || up >= min) printf "%d,%s,%.1f,%.1f,%.1f\n", now - int((cs - t1) / 100), k, dn, dn, up
			}
		}'
}

sum() { sums "$1" | awk -F, -v m="$2" '$1 == m { sub(/^[^,]*,/, ""); print; f = 1 } END { if (!f) print "0,0,0,0,0.0,0" }'; }

# limits on the access points, see the top. Callers hold /var/lock/devlog-tc.
apply() {
	want=$(awk '$2 == 1 { print $1, $3 }' $LIM 2>/dev/null | sort)
	for d in $(aps); do
		st=/tmp/devlog.tc.$d
		if [ -z "$want" ]; then
			[ -f $st ] && { tc qdisc del dev $d root 2>/dev/null; rm -f $st; }
			continue
		fi
		# already there (a Wi-Fi restart drops it, and the state file stays)
		[ "$(cat $st 2>/dev/null)" = "$want" ] && tc qdisc show dev $d | grep -q '^qdisc htb 1:' && continue
		tc qdisc del dev $d root 2>/dev/null
		# default 0: a device without a limit goes to the direct queue, unshaped
		tc qdisc add dev $d root handle 1: htb default 0 direct_qlen 1000 || continue
		n=10
		echo "$want" | while read m v; do
			b=$((v * 4)); [ $b -lt 16 ] && b=16
			# +5%: the rate counts each packet's headers (1514 bytes on the wire for
			# 1448 of data), speed tests count only the data
			r=$((v * 1050))
			tc class add dev $d parent 1: classid 1:$n htb rate ${r}kbit ceil ${r}kbit burst ${b}k cburst ${b}k quantum 1514
			# fq_codel's default 4 MB fills with offloaded (merged) packets and drops
			# them, so TCP kept slowing down: 40 Mbps gave 33; with 32 MB, 38
			tc qdisc add dev $d parent 1:$n fq_codel memory_limit 32Mb
			tc filter add dev $d parent 1: protocol all prio 1 u32 match ether dst $m flowid 1:$n
			n=$((n + 1))
		done
		echo "$want" > $st
	done
}

limit() {
	case "$1" in [0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]) ;; *) echo "bad mac"; return 1 ;; esac
	case "$2" in 0|1) ;; *) echo "bad on"; return 1 ;; esac
	case "$3" in ''|*[!0-9]*) echo "bad Mbps"; return 1 ;; esac
	[ $3 -ge 1 ] && [ $3 -le 1000 ] || { echo "Mbps must be 1-1000"; return 1; }
	lock /var/lock/devlog-tc
	{ grep -v "^$1 " $LIM 2>/dev/null; echo "$1 $2 $3"; } > $LIM.tmp && mv $LIM.tmp $LIM
	apply
	lock -u /var/lock/devlog-tc
	logger -t devlog "limit $1 $([ $2 = 1 ] && echo "on, $3 Mbps" || echo off)"
	echo ok
}

devs() {
	# plus the devices on Wi-Fi now (0 MB), so the TV can be picked before it streamed
	{
		cat $LOG $NEW 2>/dev/null | awk -F, -v from=$(from $1) '$1 >= from { mb[$2] += $3 * 7.5 } END { for (m in mb) printf "%s %.0f\n", m, mb[m] }'
		awk '{ print $2, 0 }' $SNAP 2>/dev/null
		awk '{ print $1, 0 }' $LIM 2>/dev/null
	} | awk '!($1 in s) || $2 > s[$1] { s[$1] = $2 } END { for (m in s) print m, s[m] }' |
		sort -k2 -rn | while read m mb; do
			n=$(awk -v m=$m '$2 == m && $4 != "*" { print $4; exit }' /tmp/dhcp.leases)
			[ -n "$n" ] || n=$(awk -v m=$m '$1 == m { print $2; exit }' $NAMES 2>/dev/null)
			echo "$m,$(printf '%s' "${n:-$m}" | tr -cd 'A-Za-z0-9._ -'),$mb"
		done
}

case "$1" in
	rows) rows "${2:-24}" "$3" ;;
	sum) sum "${2:-24}" "$3" ;;
	sums) sums "${2:-24}" ;;
	devs) devs "${2:-24}" ;;
	now) live ;;
	lims) awk '{ print $1 "," $2 "," $3 }' $LIM 2>/dev/null ;;
	limit) limit "$2" "$3" "$4" ;;
	apply) lock /var/lock/devlog-tc; apply; lock -u /var/lock/devlog-tc ;;
	# cron: the ~50 s run goes to the background, because busybox crond still
	# counts a job that ended late in the minute as running and skips the next one
	"") "$0" run </dev/null >/dev/null 2>&1 & ;;
	run)
		lock /var/lock/devlog-tc; apply; lock -u /var/lock/devlog-tc
		lock -n /var/lock/devlog || exit 0
		m=$(date +%M)
		sample
		[ $m = 00 ] && flush
		lock -u /var/lock/devlog ;;
esac
