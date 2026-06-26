---
title: Expand the search-backend roster beyond searxng/tavily-compat/custom
slug: expand-search-backend-roster
---

## The itch

webveil ships three backends (`searxng`, `tavily-compat`, `custom`), but of these the only
one that is BOTH real-web-search AND account-free is `searxng` (which you must self-host).
`tavily-compat` against hosted Tavily needs an account/key (the model webveil exists to
replace); against a self-hosted Tavily-shaped service it is back to self-hosting. `custom`
is infinitely flexible but DIY. So for the headline "account-free real web search" promise,
webveil is effectively searxng-only, and searxng means self-hosting. That feels limited.

## The structural wall (do not fight it)

Pick any TWO of {account-free, real web results, zero-setup}. There is NO source in the
ecosystem with all three (see `default-backend-policy-account-vs-origin`). So the goal is
NOT a magic keyless zero-setup engine (it does not exist); it is MORE OPTIONS within the
honest tradeoffs, so "account-free search" is not synonymous with "run SearXNG".

## Candidate backends (with their tradeoff corner)

- **Brave Search API** (`api.search.brave.com/res/v1/web/search`): real independent index;
  KEYED via an `X-Subscription-Token` header (free tier exists, card-on-file). JSON shape is
  its OWN (results under `web.results[]` with title/url/description), NOT Tavily-shaped, so
  its own backend (small: one file + registry line + tests). Corner: zero-setup +
  real-results, NOT account-free. Probably the most valuable keyed option.
- **Mojeek**: independent crawler/index with a (paid/keyed) API; smaller but genuinely
  independent. **Marginalia / Stract**: independent, non-commercial indexes (Marginalia has
  a small-web/old-web bias), some with open or self-hostable APIs; niche, evaluate per use
  case, not general-purpose.
- **`ddg-instant`**: DDG Instant Answer API, keyless + zero-setup, but NOT web search
  (definitions/abstracts; blank for most queries). Only honest if labelled as such; narrow.
  FULL DDG access-method analysis (no clean keyless DDG web-search; the vqd token; the 202
  rate-limit; and that proxies make DDG-scraping WORSE, anti-synergistic with our egress)
  is in the finding `duckduckgo-access-methods`: read it before ANY DDG backend attempt. The
  cleanest "I want DDG results" answer is usually SearXNG's `duckduckgo` ENGINE, not a
  dedicated backend.
- **Public SearXNG instance**: keyless real results, ZERO self-hosting, but third-party
  (operator sees your query CONTENTS) and many block `format=json`. Coherent ONLY behind
  webveil's egress proxy: see the dedicated note `public-searxng-over-egress`.
- **Playwright-driven engine backend**: drive a real browser against Google/Bing/DDG
  directly, account-free, through your egress. Big dependency + anti-bot fragility: see the
  dedicated note `playwright-search-backend`.

## The seam is cheap; the cost is the dep/tradeoff, not the code

Adding a keyed-HTTP backend (Brave, Mojeek) is the SAME pattern proven three times: a
`create<Name>Backend(config)` returning `{ search }`, normalize the response to
`SearchResult[]`, append one line in `core/backends/registry.ts` (append-only, no conflict),
and seam-test against a fake `http`. Auth is a header built from `config.apiKey`
(tavily-compat already does the Bearer pattern; Brave would use `X-Subscription-Token`). So
"which backends" is a PRODUCT decision, not an architecture one.

## Two distinct user itches (they point at different answers)

- **(a) "I do not want to self-host anything."** Best answer today is
  public-SearXNG-over-egress (no new code, just docs + the anonymity caveat). The Playwright
  backend is the heavier future option.
- **(b) "I want more engine CHOICE."** New first-class backends (Brave / Mojeek / ...).
  Real work, but each is a backend file + registry line + tests (the seam is append-only,
  proven by searxng/tavily/custom).

## Why an idea, not tasks yet

Which backends to add is a product/scope call (and several are humanOnly-ish: they trade
away account-free-ness or add heavy deps). Decide the direction (a vs b, and which engines)
before tasking. The architecture already supports any of them cheaply; the cost is choosing
WHICH tradeoffs webveil wants to bless as first-class.
