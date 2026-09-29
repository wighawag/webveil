---
title: Expand the search-backend roster beyond searxng/tavily-compat/custom/serpcast
slug: expand-search-backend-roster
---

## The itch

webveil ships four backends (`searxng`, `tavily-compat`, `custom`, `serpcast`). Two of them give real web results with no account: `searxng` (a service you run) and `serpcast` (webveil queries engines itself from recipes you provide, over libcurl-impersonate, with a searchcast browser fallback; shipped by the spec `work/specs/tasked/serpcast-backend.md`). So "account-free search" no longer means "run SearXNG". What remains open is more engine CHOICE and the keyed or anonymously-paid lanes below.

## The structural wall (do not fight it)

Pick any TWO of {account-free, real web results, zero-setup}. There is NO source in the ecosystem with all three (see `default-backend-policy-account-vs-origin`). serpcast does not break the wall either: it needs recipes (none ship for a real site) and a native library. The goal stays MORE OPTIONS within the honest tradeoffs.

## Candidate backends (with their tradeoff corner)

- **Brave Search API** (`api.search.brave.com/res/v1/web/search`): real independent index; KEYED via an `X-Subscription-Token` header (free tier exists, card-on-file). JSON shape is its OWN (results under `web.results[]` with title/url/description), NOT Tavily-shaped, so its own backend (small: one file + registry line + tests). Corner: zero-setup + real-results, NOT account-free. Probably the most valuable keyed option. (A keyless JSON API could instead be a serpcast code recipe, which needs no new backend.)
- **Mojeek**: independent crawler/index with a (paid/keyed) API; smaller but genuinely independent. **Marginalia / Stract**: independent, non-commercial indexes (Marginalia has a small-web/old-web bias), some with open or self-hostable APIs; niche, evaluate per use case, not general-purpose.
- **`ddg-instant`**: DDG Instant Answer API, keyless + zero-setup, but NOT web search (definitions/abstracts; blank for most queries). Only honest if labelled as such; narrow. FULL DDG access-method analysis (no clean keyless DDG web-search; the vqd token; the 202 rate-limit; and that proxies make DDG-scraping WORSE, anti-synergistic with our egress) is in the finding `duckduckgo-access-methods`: read it before ANY DDG backend or recipe attempt.
- **Public SearXNG instance**: keyless real results, ZERO self-hosting, but third-party (operator sees your query CONTENTS) and many block `format=json`. Coherent ONLY behind webveil's egress proxy: see the dedicated note `public-searxng-over-egress`.

## The seam is cheap; the cost is the dep/tradeoff, not the code

Adding a keyed-HTTP backend (Brave, Mojeek) is the SAME pattern proven four times: a `create<Name>Backend(config)` returning `{ search }`, normalize the response to `SearchResult[]`, append one line in `core/backends/registry.ts` (append-only, no conflict), and seam-test against a fake `http`. Auth is a header built from `config.apiKey` (tavily-compat already does the Bearer pattern; Brave would use `X-Subscription-Token`). So "which backends" is a PRODUCT decision, not an architecture one.

## A third lane: paid, but ANONYMOUSLY paid

Beyond "account-free" vs "account-bound key" there is a middle lane: commercial APIs payable without an identity (Kagi via BTC/Lightning + pseudonymous account + Tor; x402 wallet-as-credential APIs like Pylon / Brave bx402 / MeshSearch where a stablecoin micropayment IS the credential, no account). This is arguably the most webveil-aligned commercial option. Captured separately in `anonymous-payment-search-apis` (a `kagi` keyed backend is the cheap entry; x402 wallet flows are a heavy, separate-package undertaking).

## Why an idea, not tasks yet

Which keyed or paid backends to add is a product/scope call (they trade away account-free-ness or add heavy deps). Whether `serpcast` should become the default backend is a separate, later decision (the spec left it out of scope until recipes and libcurl installation are proven). The architecture already supports any of them cheaply; the cost is choosing WHICH tradeoffs webveil wants to bless as first-class.
