---
title: SearXNG backend + backend registry
slug: backend-searxng
prd: webveil-tool-and-pi-extension
blockedBy: [core-foundation-config-egress-http]
covers: [8]
---

## What to build

The first backend implementation plus the backend registry (name → Backend dispatcher).
SearXNG is the keyless, self-hosted metasearch default. End-to-end: the registry resolves
`backend: 'searxng'` from config to the SearXNG backend, which queries a SearXNG instance
THROUGH the injected `http` helper (so it cannot bypass egress) and returns normalized
`SearchResult[]`.

- **registry** — a small `name -> Backend` dispatcher (trimmed from pi-search-hub's
  pattern). New file; later backend tasks add their registration.
- **searxng** — POST/GET the SearXNG JSON API via the handed `http` helper; parse the
  response into `SearchResult[]` (title, url, snippet).

## Acceptance criteria

- [ ] The registry resolves `'searxng'` to the SearXNG backend; an unknown name fails
      clearly.
- [ ] The SearXNG backend parses a realistic SearXNG JSON response into
      `SearchResult[]`.
- [ ] The backend uses ONLY the injected `http` helper (no direct global fetch) — assert
      it cannot bypass egress.
- [ ] Tests cover the new behaviour against a FAKE `http` helper (no live network).

## Blocked by

- `core-foundation-config-egress-http` — needs the `Backend` interface and the `http`
  helper.

## Prompt

> Build webveil's SearXNG backend and the backend registry. SearXNG is the keyless
> self-hosted metasearch default. Read `CONTEXT.md` (backend seam) and the PRD's
> Implementation Decisions. The `Backend` interface and the proxied `http` helper come
> from the `core-foundation-config-egress-http` task.
>
> The registry is a tiny `name -> Backend` dispatcher (concept trimmed from
> pi-search-hub's registry). The SearXNG backend queries the instance via the HANDED
> `http` helper (never a direct fetch — egress must not be bypassable) and normalizes the
> JSON into `SearchResult[]`.
>
> Test at the seam: feed the backend a FAKE `http` helper returning a realistic SearXNG
> JSON payload and assert normalized `SearchResult[]`; assert the backend never reaches a
> global fetch. No live network in tests.
>
> Done = registry + searxng backend land with passing tests and a green verify gate.
> FIRST check this task against current reality; RECORD non-obvious in-scope decisions.
