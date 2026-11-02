# Changelog

Newest first. Dates are when the change landed in this repo.

## 2026-11-02

### Guest Wi-Fi v2: one QR per guest (new folder `guest-wifi-v2/`)

A new version of the Guest Pass page, in its own folder. v1 stays in
`guest-wifi/`, unchanged. v1 had one password and one set of limits shared by
every guest. In v2 every guest gets a pass of their own.

- **Fresh install or upgrade, same script.** `guest-wifi-v2/install.sh` works
  on a router without guest Wi-Fi and on one running v1. On v1 it turns v1 off,
  then replaces its files under the same names, so the LuCI menu entry and the
  cron job stay where they were. Remove v2 with `guest-wifi-v2/uninstall.sh`.

- **Per-guest passes.** Each pass has its own 8-digit password, time, data
  limit, speed limit and number of devices (1–5). Phones that join are bound to
  the pass by MAC, so one guest can't use up another guest's data.
- **One open QR at a time.** The QR lets new phones in until the pass is full or
  15 minutes have passed. Time starts when the first phone joins.
- **Edit, +1 h, Revoke, Cancel QR** on any pass. Raising a limit brings an
  ended pass back.
- **Unlock / Add phone** opens a pass's QR again, for a phone whose MAC changed
  (iPhone rotating private address) or to add one more device.
- **No disconnects for other guests.** A new or changed pass only rewrites the
  guest password file (`wpa_psk_file`). hostapd reloads that file without
  restarting Wi-Fi, and only phones whose password was removed are dropped.
  Tested with a real phone.
- **Limits per pass.** Download is shaped with HTB on an ifb (one class per
  pass), upload with nftables `limit` on the guest APs. All guests together are
  capped (30 Mbps default, `uci set guestwifi.ui.cap=…`).
- **Two page styles**, Wallet and Dashboard, picked in Settings (saved in
  `/etc/config/guestwifi`). The password shows only when you tap the eye icon.
- **Screenshots** in [`guest-wifi-v2/screenshots/`](guest-wifi-v2/screenshots).

**Changes compared with v1:**
- Guest APs are now **WPA2 only (psk2)**, with PMF off. With WPA3, every change
  of the password file disconnected all WPA3 guests once. With PMF on, phones
  got "PSK mismatch" on 2.4 GHz.
- `kmod-sched-cake` is no longer needed. `cls_u32` and `sch_htb` are used
  instead (both are in `kmod-sched-core`).
- `guestwifi.sh` commands changed. `on`/`off` are now `power 1|0`, and
  there are new commands for passes (see the script's header).

**Fixes found while testing on the router:**
- Files written from rpcd were root-only (umask 077). hostapd, which runs as user
  `network`, couldn't read them, so it restarted the whole radio and the home
  SSIDs dropped for a few seconds. The files are now `root:network 640`.
- A phone of a revoked pass that scanned a new QR stayed unbound. It is now
  bound to the new pass.
- A revoked phone was banned for 60 s and couldn't use a new QR in that time.
  The ban is now 5 s.

### Device Usage

- `devlog.sh` no longer puts speed limits on the guest APs (`guest*`). Guest
  Wi-Fi v2 shapes those per pass.

### Health

- Added the Health page: RAM, CPU, temperature, flash, service watchdog and daily summary.

## 2026-10-31

- Added the Guest Wi-Fi page (v1): one guest password with a timer, data cap and speed cap.
- Added the Speed Test and Device Usage pages, the DNS hijack snippet and the CLAT guide.
- Kept LF line endings in Windows clones.
