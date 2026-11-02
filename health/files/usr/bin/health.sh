#!/bin/sh
# Copyright (c) 2026 Prateek Agrawal, MIT License
# https://github.com/devprateekagrawal/Jio-6J11-openwrt-luci-extras
# Health page (LuCI Services -> Health): RAM, CPU per core, CLAT (tayga) load if
# you run one, temperature, flash and /tmp, and whether your key services and
# cron jobs run. Cron runs it every minute (~30 ms); the page (rpcd
# /usr/libexec/rpcd/health) only reads what it writes.
# Files:
#  /etc/health.services  the services to watch, one per line (see that file)
#  /etc/health.hook      optional, run on each change: <name> <up|down> <detail> <label>
#  /tmp/health.csv       samples, last 24 h:
#                        ts,memavail_kb,tayga,load1,tcpu,tmax,tmp_kb,overlay_kb,ndown,cpu0,cpu1,...
#                        (cpu/tayga in % of one core, temps in C; one cpu column per core)
#  /tmp/health.info      the latest readings as key=value lines
#  /tmp/health.state     name|state|since|bad|detail|label|description per service (up, down, off)
#  /tmp/health.prev      counters of the last run (for CPU %)
#  /root/health.events   ts|name|state|detail, each change (last 300)
#  /root/health-daily.csv  one line per day:
#                        date,samples,memavail_min_kb,cpu_avg,core_max,tayga_max,tcpu_max,load_max,downs
# A service counts as down after 2 bad samples in a row; then, and when it is
# back, an event is logged and the hook (if any) runs.
# Usage: health.sh           take a sample (cron)

CSV=/tmp/health.csv
INFO=/tmp/health.info
ST=/tmp/health.state
PREV=/tmp/health.prev
EVL=/root/health.events
DAY=/root/health-daily.csv
SVC=/etc/health.services
HOOK=/etc/health.hook

now=$(date +%s)
tp=$(pidof tayga | cut -d' ' -f1)
[ -n "$tp" ] && [ -d /proc/$tp ] || tp=

# yesterday's summary, once, from the samples still in RAM
today=$(date +%F)
if [ "$(cat /tmp/health.day 2>/dev/null)" != "$today" ]; then
	if [ -s $CSV ] && [ -f /tmp/health.day ]; then
		d=$(cat /tmp/health.day)
		from=$(date -d "$d 00:00" +%s 2>/dev/null)
		[ -n "$from" ] && awk -F, -v d=$d -v from=$from -v to=$((from + 86400)) '
			$1 >= from && $1 < to && NF > 9 {
				n++; if (n == 1 || $2 < mm) mm = $2
				c = 0; for (i = 10; i <= NF; i++) { c += $i; if ($i > cm) cm = $i }
				cs += c / (NF - 9)
				if ($3 > tm) tm = $3; if ($5 > tc) tc = $5; if ($4 > lm) lm = $4
				if ($9 > 0 && !pd) dn++; pd = ($9 > 0)
			}
			END { if (n) printf "%s,%d,%d,%.1f,%d,%d,%.1f,%.2f,%d\n", d, n, mm, cs / n, cm, tm, tc, lm, dn }' $CSV >> $DAY
		[ -f $DAY ] && [ $(wc -l < $DAY) -gt 400 ] && { tail -n 365 $DAY > $DAY.new && mv $DAY.new $DAY; }
	fi
	echo $today > /tmp/health.day
fi

# the services, then when each file-watched one last changed
svc=$(grep -v '^[[:space:]]*\(#\|$\)' $SVC 2>/dev/null)
mt=$(echo "$svc" | awk -F'|' '$2 == "cron" { print $1 "|" ($7 != "" ? $7 : "/var/lock/" $1) }' |
	while IFS='|' read -r nm f; do printf '%s %s\n' "$nm" "$(date -r "$f" +%s 2>/dev/null)"; done)

# stdin: ps, then df, then the lock times, then the crontab
ev=$({ ps w; echo @df; df -k /tmp /overlay 2>/dev/null; echo @mt; echo "$mt"; echo @cron; cat /etc/crontabs/root 2>/dev/null; } |
awk -v now=$now -v tp="$tp" -v svc="$svc" -v CSV=$CSV -v INFO=$INFO -v ST=$ST -v PREV=$PREV -v zones="$(echo /sys/class/thermal/thermal_zone*)" '
function rd(f,   l) { l = ""; getline l < f; close(f); return l }
BEGIN {
	# name|kind|match|max age|label|description|file (see /etc/health.services)
	n = split(svc, S, "\n")
	sec = "ps"
}
/^@df$/ { sec = "df"; next }
/^@mt$/ { sec = "mt"; next }
/^@cron$/ { sec = "cron"; next }
sec == "ps" && $5 != "awk" { psl = psl "\n" $0 }   # not this awk: its arguments hold the names
sec == "df" && $6 == "/tmp" { tmpu = $3; tmpt = $2 }
sec == "df" && $6 == "/overlay" { ovu = $3; ovt = $2 }
sec == "mt" { last[$1] = $2 }
sec == "cron" && !/^[ \t]*#/ { cron = cron "\n" $0 }
END {
	split(rd("/proc/uptime"), u, " "); up = u[1]
	split(rd(PREV), p, " ")   # uptime, then total busy per cpu, then tayga pid and ticks
	nc = 0
	while ((getline l < "/proc/stat") > 0) {
		if (l !~ /^cpu[0-9]/) continue
		split(l, f, " ")
		t = f[2] + f[3] + f[4] + f[5] + f[6] + f[7] + f[8] + f[9]; b = t - f[5] - f[6]
		ct[nc] = t; cb[nc] = b
		cpu[nc] = (p[2 + nc * 2] != "" && t > p[2 + nc * 2]) ? sprintf("%.0f", (b - p[3 + nc * 2]) * 100 / (t - p[2 + nc * 2])) : ""
		nc++
	}
	close("/proc/stat")
	ty = ""; tcore = ""
	if (tp != "") {
		split(rd("/proc/" tp "/stat"), f, " ")
		tt = f[14] + f[15]; tcore = f[39]
		if (p[2 + nc * 2] == tp && up > p[1]) ty = (tt - p[3 + nc * 2]) / ((up - p[1]) * 100) * 100
	}
	pv = up; for (i = 0; i < nc; i++) pv = pv " " ct[i] " " cb[i]
	print pv " " tp " " tt > PREV; close(PREV)

	split(rd("/proc/loadavg"), la, " ")
	while ((getline l < "/proc/meminfo") > 0) { split(l, f, " "); mi[f[1]] = f[2] }
	close("/proc/meminfo")

	# CPU temperature: the hottest zone named cpu*, else the hottest of all
	nz = split(zones, z, " "); tcpu = ""; tmax = ""; temps = ""
	for (i = 1; i <= nz; i++) {
		ty_ = rd(z[i] "/type"); tv = rd(z[i] "/temp")
		if (ty_ == "" || tv == "") continue
		tv /= 1000
		sub(/-thermal$/, "", ty_)
		temps = temps " " ty_ ":" tv
		if (tmax == "" || tv > tmax) tmax = tv
		if (ty_ ~ /cpu/ && (tcpu == "" || tv > tcpu)) tcpu = tv
	}
	if (tcpu == "") tcpu = tmax

	# services
	first = 1
	while ((getline l < ST) > 0) { split(l, f, "|"); os[f[1]] = f[2]; osn[f[1]] = f[3]; ob[f[1]] = f[4]; first = 0 }
	close(ST)
	nd = 0
	for (i = 1; i <= n; i++) {
		if (split(S[i], f, "|") < 3) continue
		nm = f[1]; m = f[3]
		if (f[2] == "ps") {
			o = index(psl, m) ? "up" : "down"; det = ""
		} else if (!index(cron, m)) {
			o = "off"; det = "not in crontab"
		} else {
			a = (last[nm] != "") ? now - last[nm] : -1
			o = (a >= 0 && a <= f[4]) ? "up" : "down"
			det = (a < 0) ? "never ran" : ("ran " a " s ago")
		}
		s = os[nm]; since = osn[nm]; bad = 0
		if (first || s == "") { s = o; since = (o == "up" && up < 900) ? now - int(up) : now }
		else if (o != s) {
			if (o == "down" && s == "up" && ob[nm] + 1 < 2) bad = ob[nm] + 1
			else {
				print nm "|" o "|" det "|" (f[5] != "" ? f[5] : nm)
				s = o; since = now
			}
		}
		if (s == "down") nd++
		st = st nm "|" s "|" since "|" bad "|" det "|" f[5] "|" f[6] "\n"
	}
	printf "%s", st > ST ".new"; close(ST ".new")
	system("mv " ST ".new " ST)

	cl = ""; for (i = 0; i < nc; i++) cl = cl "," cpu[i]
	printf "%d,%d,%s,%s,%s,%s,%d,%d,%d%s\n", now, mi["MemAvailable:"], (ty == "" ? "" : sprintf("%.0f", ty)), la[1],
		(tcpu == "" ? "" : sprintf("%.1f", tcpu)), (tmax == "" ? "" : sprintf("%.1f", tmax)), tmpu, ovu, nd, cl >> CSV
	close(CSV)

	printf "ts=%d\nuptime=%d\ncores=%d\nmemtotal=%d\nmemavail=%d\nmemfree=%d\nswaptotal=%d\nswapfree=%d\nload=%s %s %s\n" \
		"tmpused=%d\ntmptotal=%d\novused=%d\novtotal=%d\ntayga_pid=%s\ntayga_core=%s\ntemps=%s\n",
		now, up, nc, mi["MemTotal:"], mi["MemAvailable:"], mi["MemFree:"], mi["SwapTotal:"], mi["SwapFree:"],
		la[1], la[2], la[3], tmpu, tmpt, ovu, ovt, tp, tcore, substr(temps, 2) > INFO ".new"
	close(INFO ".new")
	system("mv " INFO ".new " INFO)
}')

# keep 24 h of samples (trim once an hour)
[ $((now % 3600)) -lt 60 ] && [ $(wc -l < $CSV) -gt 1440 ] && { tail -n 1440 $CSV > $CSV.new && mv $CSV.new $CSV; }

[ -n "$ev" ] || exit 0
echo "$ev" | while IFS='|' read -r nm s det lb; do
	echo "$now|$nm|$s|$det" >> $EVL
	[ -x $HOOK ] && $HOOK "$nm" "$s" "$det" "$lb" </dev/null >/dev/null 2>&1 &
done
[ $(wc -l < $EVL) -gt 400 ] && { tail -n 300 $EVL > $EVL.new && mv $EVL.new $EVL; }
exit 0
