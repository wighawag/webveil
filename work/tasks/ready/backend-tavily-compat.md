---
title: Tavily-compat backend (/search + /extract, selected by baseUrl)
slug: backend-tavily-compat
prd: webveil-tool-and-pi-extension
blockedBy: [core-foundation-config-egress-http, backend-searxng]
covers: [8]
---

## What to build

A generic Tavily-shaped backend: POST `/search` (and optional `/extract`) against a
configured `baseUrl`, covering orio-search / searcharvester / agent-search by base URL.
End-to-end: the registry resolves `backend: 'tavily-compat'` to this backend, which calls
the Tavily-shaped endpoints via the injected `http` helper and returns normalized
`SearchResult[]`; its `/extract` (when present) is the optional `Backend.fetch` that can
override the distilly Extractor for fetch.

## Acceptance criteria

- [ ] The registry resolves `'tavily-compat'` to this backend (registration added
      alongside searxng's, file-orthogonal to the custom backend).
- [ ] The backend parses a Tavily-shaped `/search` response into `SearchResult[]`.
- [ ] The backend exposes `/extract` as the optional `Backend.fetch` (used later to
      override the distilly Extractor).
- [ ] All requests go through the injected `http` helper (egress not bypassable).
- [ ] Tests cover `/search` (and `/extract`) parsing against a FAKE `http` helper.

## Blocked by

- `core-foundation-config-egress-http` — needs the `Backend` interface + `http` helper.
- `backend-searxng` — serialized because both edit the shared `registry`; land searxng's
  registration first to avoid a merge conflict.

## Prompt

> Build webveil's Tavily-compat backend: a generic Tavily-shaped `/search` (+ optional
> `/extract`) client selected by `baseUrl`, covering orio-search / searcharvester /
> agent-search. Read `CONTEXT.md` (backend seam) and the PRD. The `Backend` interface +
> `http` helper come from `core-foundation-config-egress-http`; the registry exists from
> `backend-searxng` (add your registration to it).
>
> Requests go through the HANDED `http` helper (egress must not be bypassable). `/search`
> normalizes to `SearchResult[]`; `/extract` becomes the optional `Backend.fetch` that a
> later task uses to override the distilly Extractor.
>
> Test at the seam against a FAKE `http` helper with realistic Tavily-shaped payloads.
> Done = backend + registration land with passing tests and a green verify gate. FIRST
> check against current reality; RECORD non-obvious in-scope decisions.
