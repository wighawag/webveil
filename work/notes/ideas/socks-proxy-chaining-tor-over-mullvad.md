---
title: Expose SOCKS proxy chaining (e.g. Tor over Mullvad) as first-class egress config
slug: socks-proxy-chaining-tor-over-mullvad
---

## The idea

webveil's egress currently takes ONE SOCKS5 url. The underlying `fetch-socks`
`socksDispatcher` ALREADY supports a CHAIN (an array of SOCKS proxies), so the capability
is one config-shape change away: let a user configure an ordered list of SOCKS hops, e.g.
chain a local Tor daemon over a Mullvad SOCKS proxy (Tor-over-Mullvad) entirely inside
webveil, without OS-level plumbing.

Possible config shape (sketch, decide later):

```json
{ "egress": { "mode": "socks5", "chain": [
    "socks5://10.64.0.1:1080",      // Mullvad (entry)
    "socks5://127.0.0.1:9050"       // Tor (exit)
] } }
```

`buildDispatcher` would pass the array straight to `socksDispatcher` (it accepts
`SocksProxies` = a single proxy OR an array). Single-url config stays the backwards-compat
default.

## Why it is worth considering

- Real anonymity use case: Tor-over-VPN (and VPN-over-Tor) are common privacy patterns;
  doing it in-app means webveil's per-request, webveil-scoped egress carries the whole
  chain, without forcing the user to wire OS-level routing.
- Low implementation cost: the transport already supports it; it is mostly a config-schema
  + validation + docs change, plus deciding the precedence/shape.

## Why it is NOT urgent (and the alternatives that already exist)

- **Mullvad's built-in Tor (Onion-over-VPN) needs NO chaining**, it happens server-side,
  so webveil already gets Tor-over-Mullvad by pointing its single SOCKS5 url at Mullvad's
  endpoint with that feature enabled. Many users' "Tor over Mullvad" need is met this way
  with zero webveil change.
- **OS-level chaining works today**: run Tor while Mullvad's tunnel is up and point webveil
  at Tor's `127.0.0.1:9050`. Outside webveil, but functional.

So this is a convenience/expressiveness feature, not a missing capability. Decide whether
the in-app chain is worth the config-surface growth (and the extra validation/fail-loud
paths for a multi-hop chain) vs. leaving chaining to Mullvad-server-side Tor + the OS.

## Open questions for whoever picks this up

- Config shape: a `chain: [...]` array vs keeping `url` and adding `via: [...]`? How does it
  interact with the existing single `url`?
- Fail-loud semantics for a partial chain (one hop down), surface which hop failed.
- Does the SSRF guard / remote-DNS behaviour compose correctly across a chain? (DNS should
  still resolve at the FINAL exit proxy.) Verify before shipping.
- Scheme handling ties into the `socks5h-scheme-accepted-but-ignored` observation, resolve
  that first so a chain's per-hop scheme story is coherent.
