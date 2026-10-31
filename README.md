# OpenWrt LuCI extras (JioRouter AX6000 / JIDU6J11)

Three small LuCI pages and a few notes from my home router setup: OpenWrt on a
JioRouter AX6000 (JIDU6J11), with an IPv6-only Jio phone tethered as the uplink.

> [!CAUTION]
> **Use at your own risk.** These were built for my own setup and pulled out of
> it into generic install scripts. The pages run daily on my router (OpenWrt
> SNAPSHOT, apk, kernel 6.18, 4-core ARM, ~430 MB RAM), but **the generic
> installers haven't been tested on a fresh router, so they may fail even on
> the same JIDU6J11.** I can't offer support. Bug reports and fixes are
> welcome as GitHub issues and pull requests.
> Back up first (System → Backup / Flash Firmware → Generate archive), and
> install one page at a time.

> [!NOTE]
> **Disclosure:** I built most of this with help from Claude (Anthropic's AI).
> It wrote most of the scripts and LuCI pages. I did the planning and decided
> what to build, then tested and debugged everything on my own router.

## What's here

| Folder | What it is |
|---|---|
| [`speedtest/`](speedtest) | **Speed Test** page (Services → Speed Test). The router tests its own line to Cloudflare: ping, jitter, download and upload, for IPv4 and IPv6 separately, with live graphs and a history. Shows the CLAT (tayga) CPU load if you run one. |
| [`device-usage/`](device-usage) | **Device Usage** page (Services → Device Usage). Wi-Fi download/upload per device, minute by minute (median, 95th percentile, peak, MB used), plus optional per-device **download speed limits** (HTB on the access points). |
| [`guest-wifi/`](guest-wifi) | **Guest Wi-Fi** "Guest Pass" page (Services → Guest Wi-Fi). Turn guest Wi-Fi on for a set time (or until midnight) with a **data cap** and a **speed cap**. It turns itself off when either runs out. Shows the SSID, password and a join QR code, lists who's connected, and makes a new password in one tap. `setup.sh` creates the isolated guest network if you don't have one. |
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

- **Guest Wi-Fi**: `tc-tiny`, `kmod-sched-core`, `kmod-sched-cake`, `kmod-ifb`
  (the installer checks). Install with `sh install.sh "My Guest"`. Without a
  network called `guest`, it first runs `setup.sh`, which creates:
  - a `br-guest` bridge on `192.168.2.1/24` with DHCP;
  - one guest AP per radio, client isolation on, WPA2/WPA3, off by default;
  - a firewall zone that only allows internet (no LAN, no router access except DHCP/DNS);
  - guest DNS forced to the router.

  Already have a guest network? The page controls every wifi-iface whose
  network is `guest`; give each one an `ifname` like `guest2g` / `guest5g`.

  **Notes:**
  - The time, data and speed limits are for the **whole guest network**, shared
    by all guests. They aren't per device.
  - Time and data are checked once a minute, so a guest can go a little over
    (at 10 Mbps, up to ~75 MB).
  - After a reboot, guest Wi-Fi stays off until you turn it on again.
  - With a router-side CLAT (see docs), add `iifname "br-guest" oifname "clat" accept`
    to the CLAT forward rules, and the guest subnet to its NAT44 masquerade rule.

## Remove

```sh
sh /tmp/speedtest/uninstall.sh
sh /tmp/device-usage/uninstall.sh
sh /tmp/guest-wifi/uninstall.sh          # add --all to also delete the guest network
```

This removes every file, the cron jobs, any speed limits and the history.

## What's *not* here, and why

My router also runs an LED status scheme, an uplink watchdog, a network/battery
logger and phone control over adb. Those are tied to my exact hardware and phone,
and could restart the wrong interfaces on another router, so I'm not sharing them.

## License

MIT. See [LICENSE](LICENSE).
