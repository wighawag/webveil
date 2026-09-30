---
title: backend, config section, fetchTransport and env say searchcast; the serpcast spellings still work for one release with a warning
slug: rename-serpcast-spellings
spec: searchcast-backend
blockedBy: [move-to-searchcast-packages]
covers: [2, 4, 6]
---

## What to build

Every user-facing `serpcast` spelling gets its `searchcast` name, and the old one is still accepted for one release:

| old | new |
| --- | --- |
| `backend: "serpcast"` | `backend: "searchcast"` |
| config section `serpcast.*` (every key, including `serpcast.searchcast.*`) | `searchcast.*` (the nested browser-runner options become `searchcast.browser.*`; decide and record if another name reads better) |
| `fetchTransport: "serpcast"` | `fetchTransport: "searchcast"` |
| `fetchSerpcast.*` | `fetchSearchcast.*` |
| `WEBVEIL_SERPCAST_*` | `WEBVEIL_SEARCHCAST_*` |
| `WEBVEIL_FETCH_SERPCAST_*` | `WEBVEIL_FETCH_SEARCHCAST_*` |
| `WEBVEIL_BACKEND=serpcast` | `WEBVEIL_BACKEND=searchcast` |

- An old spelling works exactly like the new one and produces ONE clear warning per spelling (stderr for the CLI, and surfaced by pi-webveil and `webveil doctor`) naming the new spelling and saying the old one is removed in the next minor. Both spellings of the same setting in the same layer is an error naming both; across layers, the usual precedence applies to the normalised setting.
- Trust rules apply to the setting, whatever its spelling: a project `webveil.json` that sets `serpcast.codeRecipes`, `serpcast.libcurlPath`, `serpcast.searchcast.chrome` etc. is refused exactly as the new spelling is (tested for both).
- Identity keys of a config are the same whichever spelling it uses (tested).
- Code: the backend module and its tests are renamed (`backends/searchcast.ts`); internal names follow. `CONTEXT.md` and the README use the new names; the README gets "Upgrading from serpcast (webveil 0.10)" with the table above. ADR 0004 keeps its text with one added line at the top pointing to a new ADR recording this rename (read "serpcast" there as searchcast). pi-webveil's strings and README use the new names.
- Changesets: `webveil` minor and `pi-webveil` minor.

## Acceptance criteria

- [ ] Each new spelling works; each old one works with one warning; both-at-once is an error (all tested, env and files).
- [ ] Trust-layer refusals tested for old and new spellings.
- [ ] Identity key identical across spellings (tested).
- [ ] README, CONTEXT.md, the new ADR, the note on ADR 0004; the gate is green.

## Blocked by

- move-to-searchcast-packages

## Prompt

Goal: webveil speaks of searchcast, and nobody's config breaks on upgrade. The risk is the trust layer: a renamed key must not become a way around a project-config refusal. Read `packages/webveil/src/core/config.ts`, `trust.ts`, `layers.ts`, `identity.ts`, and the backend.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-backend`)

- Versions move only through `.changeset/*.md` (minor for `webveil`, and for `pi-webveil` when its published content changes); never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: the SSRF guard (every redirect, every hop), the trust layers (project `webveil.json` cannot set code, library paths, programs to run, or egress-weakening settings), per-identity state, egress on every hop, strict impersonation, no runtime download. Gate-3 checks each is still tested.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders), except the Marginalia example the owner approved.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No live network calls in tests.
