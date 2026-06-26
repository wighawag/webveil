# Extractor seam uses `distilly/fetch` with webveil's injected egress fetch

## Status

accepted

## Context and decision

distilly shipped as TWO entrypoints (see distilly's
`docs/adr/0001-rule-vs-profile-and-injected-fetch.md`): the pure `distilly`
(`htmlToMarkdown(html, …)`, no network) and the networked `distilly/fetch`
(`urlToMarkdown(url, { fetch, rules?, size? })`, where the caller INJECTS the
only transport). distilly bakes in no `fetch`: `urlToMarkdown` throws before any
I/O if none is injected.

We decided webveil's **Extractor seam calls `distilly/fetch`'s `urlToMarkdown`**
(integration style b), injecting webveil's **egress-controlled** `fetch`, rather
than fetching the HTML in webveil and calling the pure `htmlToMarkdown` (style a).

## Why

- **Shorter, cleaner output.** distilly's network **Rules** (github, mdn,
  react.dev, vuejs.org) rewrite a matching URL to its raw `.md` / API source and
  fetch THAT, which is far smaller and cleaner than scraping rendered HTML. That
  directly serves webveil's job of keeping agent context small.
- **Less code in webveil.** distilly drives the request sequencing (rule-match →
  rewrite → fetch source via our injected fetch → pure-core fallback → size
  budget). webveil stays a thin egress + MCP/CLI shell.
- **We own both repos.** Injecting our `fetch` across the MIT→AGPL boundary is
  fully under our control and does not taint distilly's reusability (it just
  accepts a `fetch` parameter).

## The hard invariant (load-bearing for webveil's anonymity guarantee)

webveil ALWAYS injects its own egress-controlled `fetch` into `distilly/fetch`,
and NEVER lets distilly use a default / global fetch. distilly throwing when no
fetch is injected is the desired fail-loud: it can never silently reach the
network un-proxied. The injected fetch carries webveil's egress (direct / http /
socks5), its fail-loud-on-unbuildable-proxy guarantee, and its SSRF guard.

## Consequences

- distilly's seam stays as a WHATWG `fetch` (`typeof globalThis.fetch`); we did
  NOT change it to accept an undici Dispatcher. distilly's public `Rule.fetch` /
  `FetchContext.fetch` are already typed as WHATWG `fetch`, and keeping it that
  way preserves distilly's runtime-agnostic reusability (no undici coupling).
- webveil's `egress.ts` therefore exposes, ALONGSIDE the proxied `http` helper
  handed to backends, an **egress-bound WHATWG `fetch`** built with undici's
  `fetch` closed over `buildDispatcher(cfg)`'s dispatcher
  (`(input, init) => undiciFetch(input, { ...init, dispatcher })`). This reuses
  the existing dispatcher; nothing new is needed on distilly's side.
- The SSRF guard (block private IPs, relaxed under proxy egress) moves INTO the
  egress-bound fetch, so it covers distilly's rule-rewritten requests too, not
  only webveil's own direct `web_fetch` GET path.
- A backend's own `/extract` (tavily-compat) still overrides the distilly
  Extractor as before.
