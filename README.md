# OpenWrt LuCI extras (JioRouter AX6000 / JIDU6J11)

Two small LuCI pages and a few notes from my home router setup: OpenWrt on a
JioRouter AX6000 (JIDU6J11), with an IPv6-only Jio phone tethered as the uplink.

> **Disclosure:** I built most of this with help from Claude (Anthropic's AI).
> It wrote most of the scripts and LuCI pages. I did the planning and decided
> what to build, then tested and debugged everything on my own router.

> **Use at your own risk.** Tested only on my router (OpenWrt SNAPSHOT, apk,
> kernel 6.18, 4-core ARM, ~430 MB RAM). It should work on other OpenWrt
> routers, but I can't promise it, and **I can't offer support**.
> Back up first (System → Backup / Flash Firmware → Generate archive).

## What's here

| Folder | What it is |
|---|---|
| [`speedtest/`](speedtest) | **Speed Test** page (Services → Speed Test). The router tests its own line to Cloudflare: ping, jitter, download and upload, for IPv4 and IPv6 separately, with live graphs and a history. Shows the CLAT (tayga) CPU load if you run one. |
| [`device-usage/`](device-usage) | **Device Usage** page (Services → Device Usage). Wi-Fi download/upload per device, minute by minute (median, 95th percentile, peak, MB used), plus optional per-device **download speed limits** (HTB on the access points). |
| [`nft-snippets/`](nft-snippets) | `30-dns-hijack.nft`: forces all LAN devices' plain DNS (IPv4 and IPv6) to the router's resolver. |
| [`docs/`](docs) | [`clat-ipv6-only-uplink.md`](docs/clat-ipv6-only-uplink.md): how to get fast IPv4 over an IPv6-only phone uplink with a router-side CLAT (tayga). |

## Install a page

Copy the folder to the router and run its installer:

```sh
# from your PC
scp -O -r speedtest root@192.168.1.1:/tmp/
# on the router
sh /tmp/speedtest/install.sh
```

Do the same for `device-usage`. Then reload LuCI: the page is under **Services**.

Installers copy the files, restart `rpcd`, clear the LuCI cache and add the files
to `/etc/sysupgrade.conf`. `device-usage` also adds a once-a-minute cron job.

### Requirements

- **Speed Test**: `curl`, nftables (fw4, the default since OpenWrt 22.03). It uses
  ~10 MB of RAM in `/tmp` while running, and its own data (each test downloads
  and uploads a few hundred MB on a fast line, so watch metered data).
- **Device Usage**: `iw`. Speed limits also need `tc` (`tc-tiny`) and
  `kmod-sched-core`. It only sees **Wi-Fi** devices (it reads the access points'
  per-station counters, which also work with hardware flow offloading).
  History is kept in `/root/devlog.csv` and written to flash once an hour.

## Remove

```sh
sh /tmp/speedtest/uninstall.sh
sh /tmp/device-usage/uninstall.sh
```

This removes every file, the cron job, any speed limits and the history.

## What's *not* here, and why

My router also runs an LED status scheme, an uplink watchdog, a network/battery
logger and phone control over adb. Those are tied to my exact hardware and phone,
and could restart the wrong interfaces on another router, so I'm not sharing them.

## License

MIT. See [LICENSE](LICENSE).
