#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Speed test for the LuCI Speed Test page (Services -> Speed Test): the router
# measures its own internet line to Cloudflare (speed.cloudflare.com, nearest
# city), IPv4 then IPv6: ping, download, upload.
#
# The test runs as its own process ("start" launches "run" detached), so
# closing the browser doesn't matter: every step has a fixed length, a watchdog
# ends the whole test after MAXT seconds, and the page shows it again when
# reopened. A test killed hard (kill -9, reboot) only leaves a pid file of a dead
# process, which counts as "not running"; nothing stays locked.
#
# Your own cron jobs can skip their run while a test is on: its pid is in
# /tmp/speedtest.pid (see /usr/lib/speedtest-busy.sh).
#
# Speed: DN parallel downloads / UN uploads, each a fixed-size request repeated
# until the step's time is up; one connection reads far below the line (mobile
# carriers slow each connection). Bytes are counted by nftables counters on Cloudflare's address
# only, so other devices' traffic is not counted, and IP/TCP headers are taken off
# as speed test sites count only the data. The first 2 s (TCP ramp-up) are left
# out of the result.
#
# Usage: speedtest.sh start [both|v4|v6] | stop | status | history

D=/tmp/speedtest
PID=/tmp/speedtest.pid
HIST=/root/speedtest.csv   # epoch,which,ping4,jit4,down4,up4,mb4,ping6,jit6,down6,up6,mb6,clatdown,clatup (last 50; clat* = tayga busiest second, % of one core)
HOST=speed.cloudflare.com
DN=6; UN=4                 # parallel connections
DUR=10                     # seconds per download / upload
MAXT=150                   # watchdog for the whole test
UA=rtr-speedtest           # curl user agent, to tell its requests apart
CLAT=clat                  # optional: a router-side CLAT (tayga) tun; its CPU load is shown if present

busy() { read _p 2>/dev/null < $PID && kill -0 "$_p" 2>/dev/null; }
cs() { read u _ < /proc/uptime; echo "${u%.*}${u#*.}"; }   # uptime in 1/100 s

# "<state>|<which>|<step>|<step start, cs>|<step length, s>|<message>|<started, epoch>"
state() { echo "$1|$WHICH|$2|$(cs)|$3|$4|$T0" > $D/state.new && mv $D/state.new $D/state; }

# Cloudflare's addresses, pinned for the whole test (curl --resolve), so the
# counters count exactly these connections
resolve() {
	a=$(nslookup $HOST 2>/dev/null | sed -n '/^Name:/,$s/^Address: *//p')
	IP4=$(echo "$a" | grep -v : | head -n 1); IP6=$(echo "$a" | grep : | head -n 1)
	IP4=${IP4:-162.159.140.220}; IP6=${IP6:-2606:4700:7::da}
}

counters() {
	# left over by a test that was killed hard: its rules would count twice
	nft delete table inet speedtest 2>/dev/null
	nft -f - <<-EOF
	table inet speedtest {
		counter rx4 { }
		counter tx4 { }
		counter rx6 { }
		counter tx6 { }
		chain i {
			type filter hook input priority -300; policy accept;
			ip saddr $IP4 counter name "rx4"
			ip6 saddr $IP6 counter name "rx6"
		}
		chain o {
			type filter hook output priority -300; policy accept;
			ip daddr $IP4 counter name "tx4"
			ip6 daddr $IP6 counter name "tx6"
		}
	}
	EOF
}
# tayga's CPU time so far (user + system, 1/100 s), "-" without it
tk() { [ -n "$TP" ] && awk '{ print $14 + $15 }' /proc/$TP/stat 2>/dev/null || echo -; }
# "<packets> <bytes>"
count() { nft list counter inet speedtest $1 2>/dev/null | awk '/packets/ { print $2, $4 }'; }

# one connection: the same request again and again until the step ends
worker() {
	n=$1; shift
	while [ -e $D/go ]; do
		curl -s -o /dev/null -A $UA -m $((DUR + 3)) "$@" &
		echo $! > $D/w$n; wait $!
	done
}
# only the workers are waited for, not the watchdog
stopwork() {
	rm -f $D/go
	for _f in $D/w*; do [ -e "$_f" ] && read _w < $_f && kill $_w 2>/dev/null; done
	[ -n "$WK" ] && wait $WK
	WK=; rm -f $D/w*
}

# avg ms and jitter (mean change between pings) for 10 pings, "- -" if none came back
pingit() {
	ping -$1 -A -c 10 -W 2 $2 2>/dev/null | awk -F'time=' '
		NF > 1 { t = $2 + 0; s += t; if (n) j += (t > l ? t - l : l - t); l = t; n++ }
		END { if (n) printf "%.0f %.0f\n", s / n, (n > 1 ? j / (n - 1) : 0); else print "- -" }'
}

# one download or upload step: $1 v4|v6, $2 down|up. Samples, once a second, in
# $D/<p>.<step>: "<fraction of the step> <Mbps>"; result in $D/<p>.<step>.res: "<Mbps> <MB used>"
measure() {
	p=$1; ph=$2; f=${p#v}
	[ $ph = down ] && c=rx$f || c=tx$f
	[ $f = 4 ] && { h=52; ip=$IP4; } || { h=72; ip="[$IP6]"; }   # IP + TCP (with timestamps) header bytes
	: > $D/$p.$ph
	state run $p.$ph $DUR
	touch $D/go
	i=1
	if [ $ph = down ]; then
		while [ $i -le $DN ]; do worker $i -$f --resolve $HOST:443:$ip "https://$HOST/__down?bytes=50000000" & WK="$WK $!"; i=$((i + 1)); done
	else
		while [ $i -le $UN ]; do worker $i -$f --resolve $HOST:443:$ip -X POST -H 'Content-Type: application/octet-stream' -T $D/up.bin "https://$HOST/__up" & WK="$WK $!"; i=$((i + 1)); done
	fi
	# IPv4 through CLAT: also tayga's CPU time (single-threaded, so 100% = one core = its limit)
	TP=
	[ $f = 4 ] && [ -d /sys/class/net/$CLAT ] && TP=$(pidof tayga | cut -d' ' -f1) && [ -r /proc/$TP/stat ] || TP=
	set -- $(count $c); k0=$2; p0=$1; t0=$(cs); s=0; tk0=$(tk)
	while [ $s -lt $DUR ]; do
		sleep 1; s=$((s + 1))
		set -- $(count $c); echo "$(cs) $1 $2 $(tk)" >> $D/$p.$ph.raw
		awk -v t0=$t0 -v k0=$k0 -v p0=$p0 -v h=$h -v d=$DUR '
			{ dt = $1 - lt; if (NR == 1) dt = $1 - t0; b = ($3 - lb) - ($2 - lp) * h; if (NR == 1) b = ($3 - k0) - ($2 - p0) * h
			  if (dt > 0) printf "%.3f %.1f\n", ($1 - t0) / (d * 100), (b < 0 ? 0 : b) * 8 / 10000 / dt
			  lt = $1; lb = $3; lp = $2 }' $D/$p.$ph.raw > $D/$p.$ph
	done
	stopwork
	# result: from 2 s on; data used: everything
	awk -v t0=$t0 -v k0=$k0 -v p0=$p0 -v h=$h '
		{ t[NR] = $1; b[NR] = ($3 - k0) - ($2 - p0) * h }
		END { a = 2; if (NR < 3) a = 0; bt = a ? b[a] : 0; tt = a ? t[a] : t0
		      printf "%.1f %.1f\n", (t[NR] > tt ? (b[NR] - bt) * 8 / 10000 / (t[NR] - tt) : 0), b[NR] / 1000000 }' $D/$p.$ph.raw > $D/$p.$ph.res
	# tayga: "<average %> <busiest second %>" of one core, from 2 s on like the result
	# (CPU ticks are 1/100 s, like the cs timestamps)
	[ -n "$TP" ] && awk -v t0=$t0 -v k0=$tk0 '
		$4 == "-" { next }
		{ d = $1 - (NR > 1 ? lt : t0); v = (d > 0 ? ($4 - (NR > 1 ? lk : k0)) * 100 / d : 0); if (v < 0) v = 0
		  if (NR >= 3) { if (v > mx) mx = v; if (!a) { at = lt; ak = lk; a = 1 } }
		  lt = $1; lk = $4 }
		END { if (a && lt > at) printf "%.0f %.0f\n", (lk - ak) * 100 / (lt - at), mx }' $D/$p.$ph.raw > $D/$p.$ph.cpu
	[ -s $D/$p.$ph.cpu ] || rm -f $D/$p.$ph.cpu
	rm -f $D/$p.$ph.raw
}

# one protocol: ping, download, upload -> $D/<p>.res "ping jit down up mb"
proto() {
	p=$1; f=${p#v}
	[ $f = 4 ] && ip=$IP4 || ip=$IP6
	# no default route for this family (IPv6's is source-specific, so "route get" can't tell)
	if [ -z "$(ip -$f route show default 2>/dev/null)" ]; then
		echo "- - - - - no route" > $D/$p.res; return
	fi
	state run $p.ping 3
	set -- $(pingit $f $ip); pg=$1; jt=$2
	echo "$pg $jt - - -" > $D/$p.res
	measure $p down; read dn mbd < $D/$p.down.res
	echo "$pg $jt $dn - -" > $D/$p.res
	measure $p up; read up mbu < $D/$p.up.res
	echo "$pg $jt $dn $up $(awk -v a=$mbd -v b=$mbu 'BEGIN { printf "%.0f", a + b }')" > $D/$p.res
}

cleanup() {
	stopwork
	[ -n "$WD" ] && kill $WD 2>/dev/null
	nft delete table inet speedtest 2>/dev/null
	rm -f $D/up.bin
	read st _ 2>/dev/null < $D/state
	case "$st" in wait*|run*) state stopped "" 0 "Stopped." ;; esac
	[ "$(cat $PID 2>/dev/null)" = "$$" ] && rm -f $PID
}

run() {
	WHICH=$1; T0=$(date +%s)
	# one test at a time; a pid file of a dead process is cleared
	set -C
	if ! echo $$ 2>/dev/null > $PID; then
		set +C; busy && exit 0
		rm -f $PID; set -C; echo $$ 2>/dev/null > $PID || exit 0
	fi
	set +C
	trap cleanup EXIT
	trap 'exit 1' INT TERM HUP
	( sleep $MAXT; kill -TERM $$ ) >/dev/null 2>&1 &
	WD=$!
	rm -rf $D; mkdir -p $D

	state wait "" 0 "Starting"
	resolve; counters
	# which Cloudflare city answers (a few hundred bytes)
	curl -s -m 4 -A $UA "https://$HOST/cdn-cgi/trace" | sed -n 's/^colo=//p' > $D/colo
	head -c 10000000 /dev/zero > $D/up.bin
	case "$WHICH" in v4) ps=v4 ;; v6) ps=v6 ;; *) ps="v4 v6" ;; esac
	for p in $ps; do proto $p; done

	# history: one line per test, newest last; empty fields for what wasn't measured
	line="$T0,$WHICH"
	for p in v4 v6; do
		line="$line$( { cat $D/$p.res 2>/dev/null || echo; } | awk '{ for (i = 1; i <= 5; i++) printf ",%s", ($i == "-" ? "" : $i) }')"
	done
	# tayga's busiest second (% of one core) during the IPv4 download and upload
	for ph in down up; do line="$line,$(cut -d' ' -f2 $D/v4.$ph.cpu 2>/dev/null)"; done
	{ tail -n 49 $HIST 2>/dev/null; echo "$line"; } > $HIST.new && mv $HIST.new $HIST
	state done "" 0 ""
}

# "S <state>|<which>|<step>|<in the step, cs>|<step length, s>|<message>|<started>|<CLAT 1/0>|<Cloudflare city code>|<uplink>"
# then "R <p> <ping> <jitter> <down> <up> <MB>", "D <p>.<down|up> <fraction>:<Mbps> ..."
# and "C v4.<down|up> <average %> <busiest second %>" (tayga's CPU, of one core)
status() {
	clat=0; [ -d /sys/class/net/$CLAT ] && clat=1
	# the uplink: the interface of the default route (IPv6's when IPv4 goes through CLAT)
	up=$( { ip -4 route show default; ip -6 route show default; } 2>/dev/null |
		sed -n 's/.* dev \([^ ]*\).*/\1/p' | grep -vx "$CLAT" | head -n 1)
	[ -f $D/state ] || { echo "S idle|||0|0||0|$clat||$up"; return; }
	IFS='|' read st which step t dur msg t0 < $D/state
	# killed hard: the state still says running
	case "$st" in wait|run) busy || { st=stopped; msg="Stopped."; } ;; esac
	el=$(( $(cs) - t ))
	echo "S $st|$which|$step|$el|$dur|$msg|$t0|$clat|$(cat $D/colo 2>/dev/null)|$up"
	for p in v4 v6; do [ -f $D/$p.res ] && echo "R $p $(cat $D/$p.res)"; done
	for f in $D/v4.down $D/v4.up $D/v6.down $D/v6.up; do
		[ -s $f ] && echo "D ${f##*/} $(awk '{ printf "%s:%s ", $1, $2 }' $f)"
	done
	for f in $D/v4.down.cpu $D/v4.up.cpu; do [ -s $f ] && echo "C v4.$(basename $f .cpu | cut -d. -f2) $(cat $f)"; done
}

case "$1" in
	start)
		busy && { echo "busy"; exit 0; }
		case "$2" in v4|v6) w=$2 ;; *) w=both ;; esac
		setsid /usr/bin/speedtest.sh run $w </dev/null >/dev/null 2>&1 &
		# until it has taken the pid file, so a second click sees it running
		i=0; while ! busy && [ $i -lt 10 ]; do sleep 1; i=$((i + 1)); done
		busy && echo started || echo "failed" ;;
	run) run "$2" ;;
	stop)
		busy && kill -TERM $_p && echo stopped || echo "not running" ;;
	status) status ;;
	history) cat $HIST 2>/dev/null ;;
	*) echo "usage: $0 start [both|v4|v6] | stop | status | history"; exit 1 ;;
esac
