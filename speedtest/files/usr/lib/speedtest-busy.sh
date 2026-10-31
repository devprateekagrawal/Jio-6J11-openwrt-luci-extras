# The Speed Test page's test (/usr/bin/speedtest.sh) is running: its pid is in
# /tmp/speedtest.pid and still alive. Source it from your own cron jobs that use
# the line (watchdogs, loggers, failover checks) so they don't measure or restart
# anything in the middle of a test:
#   . /usr/lib/speedtest-busy.sh; speedtest_busy && exit 0
# Only a pid check, nothing is locked: a test that was killed hard counts as not
# running.

speedtest_busy() { read _sp 2>/dev/null < /tmp/speedtest.pid && kill -0 "$_sp" 2>/dev/null; }

# wait for it to end, at most 160 s (the test's watchdog is 150 s); 1 if it still runs
speedtest_wait() {
	_sw=0
	while speedtest_busy; do
		_sw=$((_sw + 1)); [ $_sw -ge 80 ] && return 1
		sleep 2
	done
}
