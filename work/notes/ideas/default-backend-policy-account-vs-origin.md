---
title: Reconsider the default backend — "no account" and "no third-party origin" are SEPARATE wins
slug: default-backend-policy-account-vs-origin
---

## The idea

The current default is `backend: searxng, baseUrl: http://127.0.0.1:8080, egress: direct`
(localhost). That fails out of the box unless the user runs a local SearXNG. The question
"should the default point at a public host instead?" was initially dismissed as an
anonymity footgun, but that dismissal CONFLATED two independent axes. Recording the correct
framing so the default-backend decision can be made deliberately later.

## The two independent axes (the load-bearing distinction)

1. **Account identity** (the Ollama problem webveil exists to solve). Ollama's web_search
   signs every request with the user's LOGGED-IN, paying-subscriber ACCOUNT — a durable,
   personally-identifiable handle (name/billing). This is worse than an anonymous IP and is
   present REGARDLESS of network origin / VPN.
2. **Network origin** (the IP). `direct` egress uses the user's real IP; a proxy
   (`socks5`/Mullvad/Tor) replaces it with the proxy's IP.

These are ORTHOGONAL. Consequences the original "never default to a public host" framing
missed:

- A REMOTE SearXNG (a "third party") behind Mullvad/Tor sees an anonymous IP and **no
  account at all** — strictly MORE anonymous than Ollama, even though it is a third party.
  "No account / no key" is the primary win; "self-hosted" + "egress you control" is how you
  ALSO close the origin leak when you want to.
- A LOCAL SearXNG on `direct` egress still uses the user's real IP to crawl the web, so
  "self-hosted" alone does NOT deliver origin-anonymity either. Self-hosting solves the
  ACCOUNT axis, not the ORIGIN axis.
- The genuine footgun is the COMBINATION `remote instance + direct egress` (real IP + a
  stranger's server with your queries), NOT "remote instance" per se.

## Options for the default (decide later)

- **Keep localhost default, make the failure LEGIBLE** (current recommendation): a clear
  "no backend reachable at 127.0.0.1:8080 — run a SearXNG or set WEBVEIL_BASE_URL /
  .pi/webveil.json". Honest, no leak, but not zero-setup.
- **Curated remote default GATED on proxy egress**: allow a public/remote default ONLY when
  egress is a proxy; refuse (fail-loud) a remote default on `direct`. This encodes the real
  rule (the dangerous combo is what's blocked, not the remote host).
- **Document a one-line `docker run searxng`** as the blessed zero-setup path.

## The zero-setup + anonymous + real-results corner does NOT exist (do not hunt for it)

Pick any TWO of {zero-setup, real web results, no-account/anonymity}; you cannot have all
three, and this is structural, not a webveil gap. "Zero setup" means something is already
running that you do not operate = a third party; removing the third party means you run it
= setup. The ecosystem corners webveil already covers:

- **anonymity + real results** → `searxng` (costs setup: one `docker run`).
- **zero-setup + real results** → `tavily-compat` (costs an account/key — the very thing
  webveil exists to avoid, but available if the user opts in).
- **zero-setup + anonymity** → only DDG Instant Answer (NOT web search — definitions only),
  or DDG HTML scraping (fragile, ToS-violating, and blocks HARDER under proxy egress, i.e.
  anti-synergistic with webveil's anonymity mode). Neither is a real general web-search.

So the honest default story is "one `docker run searxng/searxng` and it works", not
"literally nothing". No future search should chase a zero-setup anonymous web-search
backend — it is not out there.

## Why it's an idea, not a task yet

Choosing the default is a product/anonymity-policy call (humanOnly by nature). It likely
deserves an ADR once decided (it is hard to reverse and surprising without this framing).
Source of the reframing: maintainer is a paying Ollama subscriber, so the account-identity
axis is concrete and personal — that is the axis webveil's "no account" actually removes.
