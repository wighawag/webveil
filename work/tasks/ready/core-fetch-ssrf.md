---
title: core.fetch() (list-ready internals) + SSRF guard in egress fetch + backend /extract override
slug: core-fetch-ssrf
prd: webveil-tool-and-pi-extension
blockedBy: [core-search, extractor-distilly-fetch]
covers: [1, 11, 12, 13]
---

## What to build

The plain `fetch(url, opts)` core function returning clean, size-bounded markdown with the
`truncated` flag, plus the SSRF guard. End-to-end: `core.fetch()` resolves config + egress,
applies the SSRF guard, then extracts via the Extractor seam (distilly's `urlToMarkdown`
with the injected egress fetch) OR a backend's `/extract` when the configured backend
provides one. Internals take a LIST under the hood so a future `web_batch_fetch` is a
trivial later add (no redesign).

- **list-ready internals** — the single-URL `fetch()` is a thin wrapper over a
  list-processing internal (story 12); no `web_batch_fetch` tool yet.
- **SSRF guard** — block private IPs on direct egress, RELAXED under proxy egress
  (Tor/Mullvad legitimately need it). It lives INSIDE the egress-bound `fetch` so it
  covers BOTH webveil's own GETs AND distilly's rule-rewritten requests (adapt
  leing2021/pi-search's `security.ts` approach).
- **extractor override** — a backend's `/extract` (tavily-compat) overrides the distilly
  Extractor for fetch.

Move/expand the placeholder `fetch()` from `src/index.ts` into the core module.

## Acceptance criteria

- [ ] `core.fetch()` returns `{ markdown, truncated, ... }` size-bounded via the Extractor
      (distilly) or a backend `/extract` when present.
- [ ] Internals process a LIST under the hood; the public `fetch()` is a single-URL
      wrapper (story 12) — assert the list path exists.
- [ ] SSRF: a private-IP URL is BLOCKED on direct egress and ALLOWED under proxy egress,
      asserted via the egress-bound `fetch` (so it also covers distilly's rule-rewritten
      requests, not only direct GETs).
- [ ] distilly is invoked with webveil's egress fetch (never a global) — carried over from
      the Extractor task.
- [ ] Tests cover the extractor-vs-/extract branch, the list-ready internal, and both SSRF
      cases (direct blocked / proxy allowed).

## Blocked by

- `core-search` — shares the core module + config/egress plumbing; serialize to avoid
  conflicts.
- `extractor-distilly-fetch` — `core.fetch()` uses the Extractor seam.

## Prompt

> Build webveil's `core.fetch()` + the SSRF guard. Read `CONTEXT.md` (core, Extractor,
> egress seams), `docs/adr/0001` (the SSRF guard lives INSIDE the egress-bound fetch so it
> covers distilly's rule-rewritten requests), and the PRD (stories 11/12/13). The
> Extractor seam and `core.search()` already exist.
>
> Flow: resolve config + egress → SSRF guard → extract via distilly's `urlToMarkdown`
> (with the injected egress fetch) OR the configured backend's `/extract` when present →
> return size-bounded markdown + `truncated`. Make the internals take a LIST so a future
> `web_batch_fetch` is trivial (story 12); the public `fetch()` is a single-URL wrapper.
> The placeholder `fetch()` lives in `src/index.ts`; move it into the core.
>
> SSRF (story 13): block private IPs on direct egress, RELAX under proxy egress (Tor/Mullvad
> need private addresses). Put the guard in the egress-bound fetch so distilly's requests
> are covered too. Adapt leing2021/pi-search's `security.ts` approach.
>
> Test: the extractor-vs-/extract branch, the list-ready internal, both SSRF cases, and
> that distilly is never handed a global fetch. Done = `core.fetch()` + SSRF land with
> passing tests and a green verify gate. FIRST check against current reality; RECORD
> non-obvious in-scope decisions (e.g. exactly which ranges count as private, the
> proxy-relaxation rule).
