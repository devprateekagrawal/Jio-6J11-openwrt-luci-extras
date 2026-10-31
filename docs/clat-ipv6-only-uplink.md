# IPv4 over an IPv6-only uplink: router-side CLAT with tayga

Some mobile carriers (Jio in India, for example) give a phone **only IPv6**.
The phone reaches IPv4 sites through 464XLAT: the phone's own CLAT turns
IPv4 into IPv6, and the carrier's NAT64 turns it back. When you tether that
phone to an OpenWrt router (USB or hotspot), the router gets IPv6 but **no
usable IPv4**, or IPv4 crawls through the phone's CLAT (I got ~0.5 Mbps).

The fix: run the CLAT **on the router** with `tayga`. IPv4 went from ~0.5 Mbps
to ~200 Mbps for me. IPv6 is untouched and runs at full speed.

> This is a guide, not a drop-in script. Addresses, interface names and the
> NAT64 prefix depend on your setup. Read each step and adapt it.
> Keep LAN cable access while testing.

## How it works

```
LAN device (IPv4)
  -> router: NAT44 to 192.0.0.1
  -> tayga (tun "clat"): 192.0.0.1 <-> fd64:0:0:1::1, destination -> 64:ff9b::<ipv4>
  -> router: NAT66 fd64:0:0:1::/64 -> the router's IPv6 address from the phone
  -> phone -> carrier NAT64 -> IPv4 internet
```

## 1. Prerequisites

- IPv6 works on the router through the phone (`ping -6 google.com`).
- LAN devices get IPv6 (odhcpd relay mode on the uplink works well:
  `ra`, `dhcpv6` and `ndp` set to `relay`, with the uplink marked `master`).
- Find the carrier's NAT64 prefix. Most use the well-known `64:ff9b::/96`.
  Check that it works from the router:
  ```sh
  ping -6 -c 3 64:ff9b::808:808     # 8.8.8.8 through NAT64
  ```
  If that fails, look up the prefix: `nslookup -type=AAAA ipv4only.arpa <carrier DNS>`.

## 2. Install tayga

```sh
apk add tayga kmod-tun      # or: opkg install tayga kmod-tun
```

tayga runs in userspace and needs no extra kernel module besides `tun`.
It's single-threaded, so it's capped at one CPU core. On a 4-core ARM
router that was ~200 Mbps, about what the carrier gave anyway.

## 3. tayga config and the tun interface

`/var/etc/tayga-clat.conf`:

```
tun-device clat
ipv4-addr 192.0.0.2
ipv6-addr fd64:0:0:1::2
prefix 64:ff9b::/96
map 192.0.0.1 fd64:0:0:1::1
data-dir /var/run/tayga/clat
```

Bring it up (`<uplink>` is the phone interface, e.g. `usb0`; `<gw6>` is the
IPv6 default gateway from `ip -6 route show default`):

```sh
mkdir -p /var/run/tayga/clat
tayga -c /var/etc/tayga-clat.conf --mktun
ip link set clat mtu 1480 up
ip addr add 192.0.0.1/32 dev clat
ip -6 route add fd64:0:0:1::/64 dev clat
ip -6 route replace 64:ff9b::/96 via <gw6> dev <uplink>
tayga -c /var/etc/tayga-clat.conf -p /var/run/tayga-clat.pid
ip route replace default dev clat metric 5
```

To stop it: kill tayga, `ip route del default dev clat metric 5`,
`ip -6 route del 64:ff9b::/96`, then `tayga -c /var/etc/tayga-clat.conf --rmtun`.

## 4. nftables: NAT44, NAT66 and MSS clamp

`/etc/nftables.d/40-clat.nft` (fw4 includes it in `table inet fw4`). Change
the LAN subnet and the uplink interface names to yours:

```
chain srcnat_clat {
	type nat hook postrouting priority srcnat - 1; policy accept;
	oifname "clat" ip saddr 192.168.1.0/24 masquerade comment "CLAT: LAN -> 192.0.0.1"
	oifname "usb0" ip6 saddr fd64:0:0:1::/64 masquerade comment "CLAT: tayga IPv6 -> uplink address"
}

chain mangle_forward_clat {
	type filter hook forward priority mangle; policy accept;
	oifname "clat" tcp flags syn tcp option maxseg size set rt mtu comment "CLAT: MSS clamp"
}
```

fw4 also has to let the traffic through its `forward` chain. Replies are
already allowed as established connections. Put the two rules below in
`/etc/clat/forward.nft`:

```
iifname "br-lan" oifname "clat" accept comment "CLAT: LAN IPv4 into tayga"
iifname "clat" oifname "usb0" ip6 saddr fd64:0:0:1::/64 accept comment "CLAT: translated IPv6 out to the uplink"
```

Then hook that file into the start of fw4's forward chain:

```sh
uci set firewall.clat_fwd=include
uci set firewall.clat_fwd.type='nftables'
uci set firewall.clat_fwd.path='/etc/clat/forward.nft'
uci set firewall.clat_fwd.position='chain-pre'
uci set firewall.clat_fwd.chain='forward'
uci commit firewall
fw4 check && /etc/init.d/firewall restart
```

## 5. Keep it running

The phone can reconnect, change its IPv6 prefix or be unplugged, so wrap
steps 3 and 4 in a small script with `start`, `stop` and `auto`. `auto` does this:

- starts CLAT only when the IPv6-only uplink is active (if you also use other
  uplinks with real IPv4, don't route their IPv4 through CLAT);
- health check: `ping -4 -c 2 -W 3 -I clat 8.8.8.8`, and restart on failure;
- runs from cron every minute, and from a hotplug script when the uplink
  comes up.

## 6. Check it

```sh
ip route show default          # "default dev clat metric 5"
ping -4 -c 3 1.1.1.1
curl -4 https://ifconfig.co    # shows the carrier's NAT64 IPv4
top                            # tayga's CPU during a download = its headroom
```

The **Speed Test** page in this repo shows a "CLAT load" row (tayga's busiest
second, as % of one core) when a `clat` interface exists. Near 100% means
tayga is the limit, not the line.

## Notes

- Dual-stack devices prefer IPv6 for most sites, so most traffic never
  touches tayga. Only IPv4-only sites and apps go through it.
- Jool (an in-kernel NAT64) is multi-core and faster, but its kernel module
  must match your exact kernel, which is hard on snapshot builds.
