---
title: webveil's anonymity boundary, egress anonymizes webveil's OWN hop only (the local-SearXNG trap)
slug: webveil-anonymity-boundary
source: 'derived from packages/webveil/src/core/{egress.ts,search.ts,fetch.ts} @ HEAD + reasoning about the SearXNG data-flow, 2026-06-26'
---

The load-bearing mental model for webveil anonymity. Getting this wrong produces FALSE
CONFIDENCE (you believe you are anonymous while crawling the web from your real IP), which
is worse than honest non-anonymity.

## The boundary

webveil's egress (`direct` | `http` | `socks5`) is applied per-request INSIDE webveil's own
`fetch`/`http`. It governs exactly two hops:

- webveil -> backend (the `baseUrl` request), and
- `web_fetch` -> the target URL (and the `fetch` injected into distilly).

It does NOT govern what a BACKEND does after webveil calls it. A backend's onward requests
to the public internet are the backend's own egress, outside webveil entirely.

## The trap: socks5 egress + LOCAL SearXNG = fake anonymity

A local SearXNG makes its real search-engine requests (-> Google/Bing/...) from ITS OWN
process, on your machine, with YOUR REAL IP. That hop is outside webveil's egress. So:

- `WEBVEIL_EGRESS=socks5` + `baseUrl=http://127.0.0.1:8080` is incoherent on two counts:
  1. webveil would route a LOCALHOST call through a remote proxy (Mullvad won't sensibly
     route to your 127.0.0.1 \u2014 broken/pointless), and
  2. even if it "worked", the part that needs anonymizing (SearXNG -> the engines) is
     NOT proxied. You'd feel anonymous and not be.

## The rule

PROXY THE HOP THAT ACTUALLY REACHES THE PUBLIC INTERNET.

- **Local self-hosted backend (SearXNG):** that hop is the BACKEND's. Put the proxy on the
  backend \u2014 SearXNG has `outgoing.proxies` in `settings.yml` (route its engine requests via
  Tor/SOCKS). Keep webveil `direct` (localhost->localhost needs no proxy).
- **Remote backend:** webveil's hop to it IS a public-internet hop \u2014 `socks5` on webveil is
  correct (hides your IP from the engines; note the remote backend operator still sees your
  queries).
- **`web_fetch` of arbitrary URLs:** webveil's hop IS the public hop \u2014 `socks5` is correct.

## Enforcement: fail-loud on the false-confidence combo (decided)

Decision: webveil REFUSES a non-`direct` egress (`http`/`socks5`) whose resolved `baseUrl`
is a LOOPBACK address (127.0.0.0/8, ::1, localhost). It throws an EgressError explaining
that proxying a localhost backend is almost certainly wrong (set `egress=direct` and proxy
the backend itself, or use a remote backend). Rationale: matches webveil's existing
"never silently do the wrong anonymity thing" stance; option (a) hard-fail chosen over
warn/auto-bypass to avoid false confidence. The guard keys on LOOPBACK baseUrl
specifically, so remote-SearXNG-over-SOCKS stays valid. See the task
`fail-loud-on-proxied-loopback-backend`.

(`web_fetch` is unaffected: its target is an arbitrary URL, not the loopback `baseUrl`; the
guard is about the BACKEND baseUrl hop, not fetch targets \u2014 SSRF already governs those.)
