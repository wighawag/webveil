---
title: Mullvad SOCKS5 egress mechanics (what webveil's socks5 mode can and cannot do)
slug: mullvad-socks5-egress-mechanics
source: 'Mullvad help docs retrieved 2026-06-26 (mullvad.net/en/help/socks5-proxy, /split-tunneling-with-the-mullvad-app, /different-entryexit-node-using-wireguard-and-socks5-proxy) + codeberg.org/rokosun/inclusive-split-tunneling-on-wireguard'
---

External ground truth about how Mullvad's SOCKS5 proxy works, since it constrains what
webveil's `socks5` egress mode (`WEBVEIL_EGRESS_URL=socks5://10.64.0.1:1080`) can deliver.

## The proxy only exists while a Mullvad WireGuard tunnel is up

- Mullvad's SOCKS5 proxy listens on `10.64.0.1:1080` and is **reachable ONLY when connected
  to a Mullvad WireGuard server** (the proxy lives inside the encrypted tunnel). If Mullvad
  is disconnected, apps pointed at it (incl. webveil) lose network access for those
  requests. SOCKS5 itself is unencrypted, but Mullvad runs it inside the WG tunnel, so it
  is encrypted in practice.
- Consequence for webveil: `socks5` mode is not self-contained \u2014 it depends on a Mullvad
  tunnel being established by the OS/Mullvad app. webveil only knows a SOCKS5 address; it
  has no concept of a Mullvad account or tunnel.

## The account is a property of the tunnel, not the proxy address

- A WireGuard tunnel authenticates with ONE account's key; the SOCKS5 proxy reachable
  through it belongs to THAT account. There is one active tunnel = one account at a time.
- **SOCKS5 multihop changes the EXIT LOCATION, not the account.** Pointing at
  `<server>-wg-socks5-NNN.relays.mullvad.net:1080` makes traffic exit via a different
  Mullvad server, but it still rides your single connected tunnel/account.
- Therefore "webveil under Mullvad account B while the system is on account A" is NOT
  achievable by any webveil config or any single-tunnel Mullvad setup. It requires OS-level
  isolation: a second WireGuard interface on account B inside a network namespace / VM /
  container that webveil runs in, while the host runs account A. Outside webveil's scope.

## Split routing: SOCKS5 for one app without tunnelling everything

- Default WireGuard `AllowedIPs = 0.0.0.0/0, ::0/0` routes ALL traffic through the tunnel.
- To use the proxy WITHOUT full-tunnel, either set `AllowedIPs = 10.64.0.1/32,
  10.124.0.0/22` (proxy IPs only) OR use `Table = off` + manual `PostUp`/`PreDown`
  `ip route add 10.64.0.1/32 dev %i` (the `10.124.0.0/22` range is multihop). Then only the
  proxy IP is tunnelled; everything else uses the real ISP connection.
- Mullvad's app-level "split tunneling" (exclude apps from the VPN) is the inverse feature
  and is the wrong tool here (it EXCLUDES apps from a full tunnel; we want to INCLUDE only
  the proxy IP).

## How this interacts with webveil's egress design

- webveil's egress is per-request and webveil-scoped (verified in `core/egress.ts`: the
  dispatcher is applied inside webveil's own fetch/http, not system-wide). So even without
  split routing, `git push` etc. are not proxied by webveil. Split routing is the OS-level
  belt-and-braces on top.
- DNS-leak caveat (general SOCKS5): ensure DNS is resolved through the proxy/tunnel, not
  locally, when anonymity matters. webveil's SSRF guard deliberately does NOT do a local
  DNS lookup under proxy egress (a local lookup for a proxied request would itself leak) \u2014
  see `core/security.ts` and `docs/adr/0001`.
- Footgun the docs warn about: a system-wide full-tunnel VPN under your logged-in identity
  is what can deanonymize a `git push`; webveil's scoped per-request egress avoids that by
  construction.
