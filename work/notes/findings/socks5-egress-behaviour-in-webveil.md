---
title: SOCKS5 egress behaviour & limitations in webveil (DNS, TCP-only, single-proxy, scheme)
slug: socks5-egress-behaviour-in-webveil
source: 'derived from packages/webveil/src/core/egress.ts @ HEAD (uses fetch-socks socksDispatcher type:5) + fetch-socks/socks docs & undici Socks5ProxyAgent security notes, retrieved 2026-06-26'
---

How webveil's `socks5` egress actually behaves (via `fetch-socks` -> the `socks`
library -> undici), so the anonymity properties and limits are not guessed at.

## DNS is resolved REMOTELY by default (no DNS leak), the important one

webveil hands the TARGET HOSTNAME to the SOCKS5 proxy and lets the PROXY resolve it; it
does NOT resolve locally first. The `socks` library sends a domain-name address type
(SOCKS5 ATYP 0x03) to the proxy. undici's own SOCKS5 notes: "All DNS resolution happens on
the proxy server, preventing DNS leaks." So webveil's `socks5` path behaves like `socks5h`
(remote DNS) regardless of the URL scheme written.

- Consequence: fetching a hostname through Tor (`127.0.0.1:9050`) or Mullvad
  (`10.64.0.1:1080`) does NOT leak the hostname to your local resolver. This is correct.
- The SSRF guard reinforces this: under proxy egress it does NOT do a local DNS lookup
  (a local lookup for a proxied request would itself leak), see core/security.ts +
  docs/adr/0001.

## TCP only (no UDP)

The SOCKS5 implementation supports the CONNECT command (TCP) only; no UDP ASSOCIATE. This
is irrelevant to webveil (all traffic is HTTP/HTTPS over TCP), but it means no QUIC/HTTP-3
over the proxy. undici uses HTTP/1.1–2 over TCP through the tunnel anyway.

## Single proxy, no chaining exposed

webveil's config takes ONE SOCKS5 url (`egress.url`), passed as a single proxy to
`socksDispatcher`. `fetch-socks` DOES support a proxy CHAIN (an array of SOCKS proxies),
but webveil does not surface it, so e.g. Tor-over-Mullvad chaining is not reachable via
webveil config (see the proxy-chaining idea note). Do it at the OS layer if needed.

## The `socks5` vs `socks5h` scheme is accepted but IGNORED

`socksFromUrl` accepts `socks5://`, `socks://`, AND `socks5h://`, then always builds
`type: 5` with no branch on the scheme. Because DNS is remote-by-default anyway, this is
NOT a leak, but it is misleading: the scheme is cosmetic and silently a no-op. See the
observation note `socks5h-scheme-accepted-but-ignored`.

## Auth credentials are plaintext to the proxy

If you use `socks5://user:pass@host:port`, the credentials go to the proxy in plaintext
(SOCKS5 RFC 1929) unless the proxy connection is itself TLS-wrapped. Non-issue for
localhost Tor/Mullvad (no auth); relevant only for authenticated remote SOCKS.

## Failure timing: fail-loud is at REQUEST time for reachability

`buildDispatcher` fails loud immediately on a MALFORMED url (and never falls back to
direct), but it cannot know the proxy is REACHABLE until a request is actually attempted.
So "Tor daemon down" / "Mullvad disconnected" surfaces as a thrown error on the first
request, not at config-resolution time. Still fail-loud (never silently un-proxied), just
detected at use, not up front.

## Connection pooling vs Tor circuits

undici pools/reuses connections through the SOCKS tunnel; with Tor, reused connections
share a circuit. Usually fine; if you want per-request circuit isolation, configure Tor
(`MaxCircuitDirtiness`, stream isolation), not a webveil setting.

## Mullvad's built-in Tor (Onion-over-VPN) is server-side and transparent to webveil

Mullvad's integrated Tor happens on Mullvad's servers; from webveil's side it is still just
ONE SOCKS5 endpoint (`10.64.0.1:1080`) with the tunnel doing the Tor hop. webveil needs no
special config and does not need to know Tor is involved, it works as a normal single
SOCKS5 proxy. (This is distinct from chaining a separate local Tor daemon over Mullvad,
which webveil cannot do itself, see the chaining idea.)
