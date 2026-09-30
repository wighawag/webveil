---
title: searchcast ^0.3.0 and the bundled Marginalia recipe that sends a key as API-Key, so MARGINALIA_API_KEY works
slug: marginalia-key-via-header
spec: searchcast-backend
blockedBy: [default-chain-mwmbl]
covers: [1]
---

## What to build

searchcast 0.3.0 (on npm, with provenance) lets a code recipe add an `API-Key` author header to a fetch request, and its `examples/recipes/marginalia.mjs` (searchcast commit `7015848`) now calls Marginalia's current API with `API-Key` when `MARGINALIA_API_KEY` is set, and the keyless old API otherwise. webveil's bundled copy predates that, so the README's "set `MARGINALIA_API_KEY` for more quota" today sends the key to the old API, which answered 504 all evening on 2026-09-30.

- Depend on `searchcast` `^0.3.0` (add `searchcast@0.3.0` to `minimumReleaseAgeExclude` as before).
- Refresh `packages/webveil/recipes/marginalia.mjs` as a copy of searchcast's example at commit `7015848` (record it in the header, as today). Mwmbl's copy is unchanged.
- README: the key lines say what each key does (Marginalia's key selects its current API; Mwmbl's goes in its query). No other change.
- Tests: the bundled Marginalia recipe with a key calls the current API with `api-key` (through a fake transport), without a key the old API (no network).
- Changesets: `webveil` patch and `pi-webveil` patch.

## Acceptance criteria

- [ ] searchcast ^0.3.0; the bundled Marginalia copy matches searchcast's example at `7015848` (code identical apart from its header).
- [ ] Key and no-key paths tested offline; the gate is green.

## Blocked by

- default-chain-mwmbl

## Prompt

Goal: the documented key actually helps. Small and mechanical.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-backend`)

- Versions move only through `.changeset/*.md` (as stated in the task); never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: the SSRF guard (every redirect, every hop), the trust layers (project `webveil.json` cannot set code, library paths, programs to run, or egress-weakening settings), per-identity state, egress on every hop, strict impersonation, no runtime download. Gate-3 checks each is still tested.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders), except the Marginalia and Mwmbl APIs the owner approved.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No live network calls in tests.
