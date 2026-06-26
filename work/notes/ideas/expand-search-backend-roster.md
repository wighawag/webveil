---
title: Expand the search-backend roster beyond searxng/tavily-compat/custom
slug: expand-search-backend-roster
---

## The itch

webveil ships three backends (`searxng`, `tavily-compat`, `custom`), but of these the only
one that is BOTH real-web-search AND account-free is `searxng` \u2014 which you must self-host.
`tavily-compat` against hosted Tavily needs an account/key (the model webveil exists to
replace); against a self-hosted Tavily-shaped service it is back to self-hosting. `custom`
is infinitely flexible but DIY. So for the headline "account-free real web search" promise,
webveil is effectively searxng-only, and searxng means self-hosting. That feels limited.

## The structural wall (don't fight it)

Pick any TWO of {account-free, real web results, zero-setup}. There is NO source in the
ecosystem with all three (see `default-backend-policy-account-vs-origin`). So the goal is
NOT a magic keyless zero-setup engine (it doesn't exist); it is MORE OPTIONS within the
honest tradeoffs, so "account-free search" is not synonymous with "run SearXNG".

## Candidate backends (with their tradeoff corner)

- **Brave Search API** \u2014 real independent index; KEYED (free tier exists). Different
  response shape from Tavily \u2192 likely its own backend. Corner: zero-setup, NOT account-free.
- **Mojeek / Marginalia / Stract** \u2014 independent indexes; some keyless-ish or self-hostable.
  Quality/coverage varies; worth evaluating per engine.
- **`ddg-instant`** \u2014 DDG Instant Answer API: keyless + zero-setup, but NOT web search
  (definitions/abstracts; blank for most queries). Only honest if labelled as such; narrow.
- **Public SearXNG instance** \u2014 keyless real results, ZERO self-hosting, but third-party
  (operator sees your query CONTENTS) and many block `format=json`. Coherent ONLY behind
  webveil's egress proxy \u2014 see the dedicated note `public-searxng-over-egress`.
- **Playwright-driven engine backend** \u2014 drive a real browser against Google/Bing/DDG
  directly, account-free, through your egress. Big dependency + anti-bot fragility \u2014 see the
  dedicated note `playwright-search-backend`.

## Two distinct user itches (they point at different answers)

- **(a) "I don't want to self-host anything."** \u2192 best answer today is
  public-SearXNG-over-egress (no new code, just docs + the anonymity caveat). Playwright
  backend is the heavier future option.
- **(b) "I want more engine CHOICE."** \u2192 new first-class backends (Brave / Mojeek / \u2026).
  Real work; each is a backend file + registry line + tests (the seam is append-only, proven
  by searxng/tavily/custom).

## Why an idea, not tasks yet

Which backends to add is a product/scope call (and several are humanOnly-ish: they trade
away account-free-ness or add heavy deps). Decide the direction (a vs b, and which engines)
before tasking. The architecture already supports any of them cheaply; the cost is choosing
WHICH tradeoffs webveil wants to bless as first-class.
