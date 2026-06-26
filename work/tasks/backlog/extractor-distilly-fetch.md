---
title: Extractor seam — urlToMarkdown via distilly/fetch with injected egress fetch
slug: extractor-distilly-fetch
prd: webveil-tool-and-pi-extension
blockedBy: [core-foundation-config-egress-http]
covers: [11]
---

## What to build

The Extractor seam: turn a URL into clean, size-bounded markdown by calling distilly's
networked `urlToMarkdown` from the `distilly/fetch` entrypoint, INJECTING webveil's
egress-bound `fetch` (from the foundation task) as the transport. distilly's network Rules
(github/mdn/react.dev/vuejs.org) rewrite matching URLs to raw `.md`/API source ON TOP OF
webveil's egress; non-matching URLs run through distilly's pure core. End-to-end: given a
URL + size preset, the seam returns `{ markdown, truncated }`, having reached the network
ONLY through webveil's egress fetch.

- Map webveil's `s`/`m`/`l`/`f` preset straight to distilly's `size`; surface
  distilly's `truncated`.
- The seam is the DEFAULT extractor; a backend's `/extract` overrides it (wired in the
  `core-fetch-ssrf` task).

distilly's shipped signature (pinned, do not adapt):
`urlToMarkdown(url, { fetch: typeof globalThis.fetch; rules?; size?: 's'|'m'|'l'|'f' }) => Promise<{ markdown, truncated }>`.

## Acceptance criteria

- [ ] The Extractor calls `urlToMarkdown` from `distilly/fetch` with webveil's
      egress-bound `fetch` injected — NEVER a global/default fetch.
- [ ] The `s`/`m`/`l`/`f` preset maps to distilly's `size`; `truncated` is surfaced.
- [ ] If the egress fetch cannot be built (unbuildable proxy) the call FAILS LOUD
      (distilly throws with no fetch; webveil's fetch throws on bad proxy) — never an
      un-proxied request.
- [ ] Tests assert distilly is invoked WITH the egress fetch (a spy/fake), assert the
      size→budget mapping and `truncated` passthrough, and assert no global fetch is used.

## Blocked by

- `core-foundation-config-egress-http` — needs the egress-bound `fetch`.

## Prompt

> Build webveil's Extractor seam over distilly's networked entrypoint. Read `docs/adr/0001`
> (THE decision: style b, `distilly/fetch` with injected egress fetch), `CONTEXT.md`
> (Extractor + egress seams), and the PRD. distilly is published as `distilly@^0.1.0`; you
> import the `distilly/fetch` subpath (`urlToMarkdown`).
>
> CRITICAL: webveil ALWAYS injects its egress-bound `fetch` (from
> `core-foundation-config-egress-http`) into `urlToMarkdown`; it NEVER lets distilly use a
> global/default fetch. distilly throws if no fetch is injected — that fail-loud is
> desired. distilly's Rules rewrite github/mdn/react.dev/vuejs.org to raw markdown over
> YOUR egress; that is the win (shorter output).
>
> Map webveil's `s/m/l/f` preset to distilly's `size`; surface `truncated`. This seam is
> the default extractor; the `/extract` override is wired in a later task.
>
> Test at the seam: inject a SPY fetch, assert distilly is called with it (never a global),
> assert size→budget mapping + `truncated` passthrough, and assert fail-loud when the
> egress fetch is unbuildable. Done = the Extractor lands with passing tests and a green
> verify gate. FIRST check this task against current reality (esp. `docs/adr/0001` and
> distilly's shipped signature); RECORD non-obvious in-scope decisions.
