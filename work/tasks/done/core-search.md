---
title: core.search() over the backend seam (normalize, dedup, clamp)
slug: core-search
prd: webveil-tool-and-pi-extension
blockedBy: [backend-searxng]
covers: [1, 7]
---

## What to build

The plain, framework-agnostic `search(query, opts)` core function: resolve config →
build egress dispatcher → pick the backend from the registry → call it with the proxied
`http` helper → normalize, dedup, and clamp the `SearchResult[]`. This is the single
implementation BOTH frontends (incur CLI/MCP and the pi extension) call. End-to-end and
demoable on its own with the searxng backend.

Move/expand the placeholder `search()` from `src/index.ts` into the core module.

## Acceptance criteria

- [ ] `core.search()` resolves config + egress + backend and returns normalized
      `SearchResult[]` (deduped, clamped to `maxResults`).
- [ ] It uses the egress-bound path so a backend physically cannot bypass the configured
      proxy.
- [ ] Works with at least the searxng backend; backend selection comes from config.
- [ ] Tests drive `core.search()` against a FAKE `http` helper and assert dedup + clamp
      and the normalized shape.

## Blocked by

- `backend-searxng` — needs a working backend + registry to dispatch to (and the
  foundation it transitively depends on).

## Prompt

> Build webveil's `core.search()` — the plain framework-agnostic search function both
> frontends call. Read `CONTEXT.md` (core, backend/egress/config seams) and the PRD's
> Testing Decisions. The foundation (config/egress/http/types) and the searxng backend +
> registry already exist.
>
> Flow: resolve config → build the egress dispatcher → select the backend from the
> registry → call it with the proxied `http` helper → normalize + dedup + clamp to
> `maxResults`. The placeholder `search()` lives in `src/index.ts`; move it into the core.
>
> Test at the seam: a FAKE `http` helper returning duplicate/over-limit results, asserting
> the deduped + clamped normalized output, and that the backend is handed only the proxied
> helper (no global fetch). Done = `core.search()` lands with passing tests and a green
> verify gate. FIRST check against current reality; RECORD non-obvious in-scope decisions.
