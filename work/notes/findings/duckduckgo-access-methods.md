---
title: DuckDuckGo access methods, why there is no clean keyless DDG web-search API
slug: duckduckgo-access-methods
source: 'web research 2026-06-26: DDG Instant Answer API docs (api.duckduckgo.com), SearXNG duckduckgo engine docs (docs.searxng.org/dev/engines/online/duckduckgo.html), apiserpent/iproyal scraping guides'
---

External ground truth so a future "add a DDG backend" attempt does not re-derive this from
scratch. The short version: there is NO keyless JSON WEB-SEARCH API for DDG. The endpoints
split into two incompatible things.

## The four DDG surfaces

| Endpoint | Returns | vqd token? | Keyless? |
| --- | --- | --- | --- |
| `api.duckduckgo.com` (Instant Answer) | definitions / abstracts / disambiguation \u2014 NOT web links | no | yes |
| `html.duckduckgo.com/html/` | full SERP as no-JS HTML (easiest to parse) | no (1st page) | yes |
| `lite.duckduckgo.com/lite/` | stripped no-JS HTML SERP | no (1st page) | yes |
| `duckduckgo.com` + `d.js`/`links.duckduckgo.com` | the JS SERP via a follow-up endpoint | YES | yes |

## Option A: Instant Answer API (`api.duckduckgo.com/?q=..&format=json`)

- Keyless, clean JSON, trivial (structurally like the searxng backend). BUT it is NOT web
  search: it returns Wikipedia-style abstracts / definitions / `!bang` redirects, and is
  BLANK for most real queries. DDG itself says "not a full search results API." For an
  agent's `web_search` it would disappoint on the majority of queries. Only honest if a
  backend is LABELLED "instant answers", not "web search".

## Option B: HTML / Lite endpoints (real SERP, keyless)

- `html.duckduckgo.com/html/` (POST form) returns real ten-blue-links as parseable HTML;
  `lite` is even lighter. First page needs no `vqd`. Pagination (2nd page) requires a
  server-issued `vqd` token \u2014 requesting page 2 without it is an instant block.
- Result links are WRAPPED as `/l/?uddg=<url-encoded real url>` \u2014 must decode the `uddg`
  param to get the real destination.
- DDG ACTIVELY bot-blocks this: `202 Ratelimit` (soft block) appears quickly; needs paced
  requests + exponential backoff.
- **Proxies make it WORSE, not better.** DDG leans on IP reputation and flags datacenter /
  shared / VPN / Tor exit IPs HARDER than a clean residential IP. So this path is
  ANTI-SYNERGISTIC with webveil's whole anonymity premise: turning on socks5 egress would
  INCREASE the 202s. This is the key reason DDG-html is a poor fit for a privacy tool.
- DDG ToS prohibits automated/non-personal use of these endpoints.

## Option C: the JS SERP (`d.js`, vqd-gated)

- Full results but requires the `vqd` ("validation query digest") handshake and a JS-capable
  flow; this is what SearXNG's duckduckgo engine reverse-engineers (and keeps fixing as DDG
  changes the bot blocker, e.g. Q3/Q4 2025 changes). High maintenance.

## Practical conclusions for webveil

1. The cleanest way to "get DDG results" is NOT a dedicated DDG backend at all \u2014 it is
   SearXNG's `duckduckgo` ENGINE (SearXNG already solves vqd / bot-block / parsing / proxy
   handling). I.e. "I want DDG" is mostly a SearXNG config/docs matter.
2. A standalone `ddg-instant` backend (Option A) is cheap and keyless but must be honestly
   scoped to instant answers, not web search.
3. A `ddg-html` scraping backend (Option B) delivers real results but is fragile,
   ToS-violating, and gets WORSE under webveil's proxy egress \u2014 a bad first-class fit for an
   anonymity tool.
4. A browser-driven approach (Playwright) sidesteps vqd/JS but inherits the
   proxy-IP-reputation CAPTCHA problem \u2014 see `playwright-search-backend`.
