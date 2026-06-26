---
title: Playwright-driven search backend (browser-scraped engines through webveil egress)
slug: playwright-search-backend
---

## The idea

A backend that drives a real browser (Playwright) against actual search engines
(Google/Bing/DDG/...) and parses the SERP, so webveil gets account-free real web results
WITHOUT self-hosting SearXNG. The browser is launched with webveil's SOCKS5 proxy so the
engine traffic routes through Mullvad/Tor (anonymity-preserving). Fits the backend seam:
one `createPlaywrightBackend(config)` returning `{ search }` (and possibly `fetch`).

## Feasibility verified (Playwright + SOCKS5 + Mullvad)

Source: Playwright docs + microsoft/playwright#10567, retrieved 2026-06-26.

- Playwright DOES support SOCKS5: `chromium.launch({ proxy: { server: 'socks5://host:port' } })`
  (passes `--proxy-server` to Chromium). Page traffic exits via the proxy. So passing
  webveil's SOCKS proxy to the browser DOES make the instance route through Mullvad. \u2705
- **Chromium limitation: SOCKS5 WITH AUTH is unsupported** (`net::ERR_PROXY_AUTH_UNSUPPORTED`).
  Longstanding Chromium constraint; Firefox/WebKit support auth, Chromium does not.
  **BUT Mullvad's `10.64.0.1:1080` and local Tor `127.0.0.1:9050` need NO auth** (gated by
  the tunnel/locality), so the limitation does NOT bite for our use case. It only matters
  for commercial auth'd SOCKS providers (workaround: a local no-auth SOCKS shim, or use the
  Firefox engine).
- **DNS:** Chromium with `--proxy-server=socks5://` resolves DNS at the proxy by default \u2192
  no DNS leak (consistent with webveil's non-browser path).
- **WebRTC leak (browser-specific!):** a browser can leak the real IP via WebRTC/STUN even
  behind a proxy. A Playwright backend MUST disable it
  (`--force-webrtc-ip-handling-policy` / `--webrtc-ip-handling-policy=disable_non_proxied_udp`)
  or block UDP. This is a NEW leak surface the HTTP backends do not have.

## Why it is attractive

- Directly answers the "searxng-only / must self-host" limitation: query engines directly,
  account-free, through your egress, no SearXNG to run.
- Browser rendering handles JS-heavy SERPs that the DDG-html/lite scraping path cannot.

## Why it is NOT a slam dunk (costs, eyes open)

- **Heavy dependency.** Playwright + a browser binary is a large footprint vs webveil's
  current "core < ~1.6k LOC, lean on incur+distilly" identity. Probably an OPTIONAL/peer
  dep or a separate backend package, not a core dep.
- **Anti-bot fragility.** Google/Bing fight automation hard (CAPTCHAs, bot detection),
  MORE so than they fight a clean SearXNG instance or its keyed APIs. SERP HTML/selectors
  change \u2192 ongoing maintenance. Through a VPN/Tor exit IP, CAPTCHAs increase further.
- **Per-search cost/latency.** Launching/driving a browser per query is far heavier than an
  HTTP GET to SearXNG.
- **Egress wiring nuance.** webveil's egress is currently an undici dispatcher injected into
  fetch; a Playwright backend would instead pass the SOCKS URL to the browser launch \u2014 a
  DIFFERENT injection path. The backend would need webveil's resolved egress config (the
  SOCKS url), not the undici dispatcher. Worth designing so the egress single-source-of-
  truth is honoured (the browser must NOT bypass it \u2014 same fail-loud spirit).

## Open questions for whoever picks this up

- Core dep vs optional vs separate package (`webveil-playwright`)? (Leaning separate/optional
  given the weight.)
- Which engines, and how to keep selectors maintainable (per-engine profile, like distilly's
  Profiles)? Could even reuse SearXNG's engine definitions as prior art.
- How does the egress config reach the backend as a SOCKS URL (not a dispatcher), and how is
  "browser must use the proxy, fail loud otherwise" enforced (Chromium has no easy
  fail-closed; consider blocking non-proxied UDP + verifying exit IP on launch)?
- WebRTC/canvas/fingerprint hardening scope \u2014 how far does webveil go vs leaving it to the
  user/instance?

## Engine friendliness + stealth (research from a parallel session, 2026-06-26)

Bot detection is the cost that REPLACES the account/payment cost. Concrete guidance:

- **Engine targets, friendliest to most hostile:** `html.duckduckgo.com/html/` and
  Startpage are the friendliest scrape targets; Bing and Brave web are more tolerant but
  not immune; **Google is the most aggressive** (datacenter-IP + headless-fingerprint
  blocking, fast CAPTCHAs), avoid unless you enjoy pain. Through a VPN/Tor EXIT IP, CAPTCHAs
  INCREASE (the engine sees a flagged IP), which compounds with webveil's anonymity goal.
- **Vanilla headless Playwright is detectable** (`navigator.webdriver`, headless UA, missing
  `chrome` runtime). Passing basic checks needs `playwright-extra` + the stealth plugin, or
  `rebrowser-playwright`. That is extra dependency + tuning surface on top of Playwright.
- **Privacy comes from the NETWORK layer (VPN/Tor/proxy exit + fingerprint), not a vendor.**
  This is the real "Mullvad-like" property: there is literally no provider relationship, no
  account, no payment. The engine sees an exit IP + a browser fingerprint, nothing tied to
  an identity. This is exactly why webveil's egress (Mullvad/Tor) is the right network layer
  for it.

## The fetch-first / escalate-to-browser pattern (preferred architecture)

The pragmatic shape used by prior art (Free-Search = Playwright + SearXNG;
zero-api-key-web-search's browse layer) is NOT "Playwright against Google". It is a LADDER:

1. Try the cheap path first (a SearXNG JSON call, or a plain `http` fetch of a friendly
   endpoint like DDG-html).
2. ESCALATE to a Playwright browser ONLY for the specific pages that are JS-heavy or
   soft-blocked (the "unlocker" role).

So in webveil terms, a Playwright backend is best framed as a FALLBACK/unlocker behind the
lighter backends, not the primary. Self-hosted SearXNG (server-side scraping -> clean JSON,
behind your egress) remains the lighter, more stable, more anonymous bulk path; Playwright
is the back-pocket tool for what SearXNG / a plain fetch cannot get. This also limits the
heavy browser cost to the minority of queries that actually need it.

## Relation to other notes

- One concrete entry under `expand-search-backend-roster` (the heaviest, most powerful one).
- A LIGHTER cousin of the same no-account goal: `public-searxng-over-egress` (no browser).
- The anonymous-PAYMENT commercial path (Kagi BTC, x402 wallet-as-credential) is a SEPARATE
  category: see `anonymous-payment-search-apis`.
- DDG-specific scrape realities (vqd, 202, proxy-makes-it-worse) in the finding
  `duckduckgo-access-methods`.
- Egress interaction bounded by `webveil-anonymity-boundary` + `socks5-egress-behaviour-in-webveil`.
