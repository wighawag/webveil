---
title: searchcast is the default backend, with a bundled Marginalia engine chain, so one install is enough
slug: default-backend-searchcast
spec: searchcast-backend
blockedBy: [rename-serpcast-spellings]
covers: [1, 3, 6]
---

## What to build

The default config becomes `backend: "searchcast"` (was `searxng` at `http://127.0.0.1:8080`), still on `direct` egress. When the user configures no engines, recipes and code recipes for the searchcast backend, the engine chain is `["marginalia"]` from a code recipe BUNDLED in the webveil package (a copy of searchcast's `examples/recipes/marginalia.mjs`, owner-approved on 2026-09-29 and again on 2026-09-30: the Marginalia Search API is meant for programs; key from `MARGINALIA_API_KEY`, else the shared `public` key; results CC-BY-NC-SA 4.0). Any user-configured engines, recipes or code recipes replace the default chain entirely (no merge).

- The bundled recipe is trusted because it ships in the package: loading it is not a project-config code path and does not relax any trust rule (a project `webveil.json` still cannot add code recipes). Keep its header comment with the terms and the source; the README states them (shared, rate-limited key; get a free personal key; results licence).
- `fetchTransport` keeps following the backend, so `web_fetch` now defaults to the impersonated transport. Where the library is not available (unsupported platform, skipped optional dependency), both search and fetch fail loud with the hint (`webveil install-libcurl`, or `"fetchTransport": "plain"`); no silent fallback to a Node fingerprint.
- Users who relied on the implicit SearXNG default: do not probe for a local SearXNG (that would be a guess and a network call the user did not ask for). Instead, when the backend is the default one, the error text of a failed search and `webveil doctor` mention that the default changed and that `backend: "searxng"` restores it. The README's quick start leads with "install and search", then SearXNG and private recipe sets as options; the old "no option is zero-setup" paragraph is updated honestly (zero setup now gives one small independent index through a shared key).
- A test that a fresh config (no files, no env) resolves to the searchcast backend with the bundled chain, that any user engine setting replaces it, and a search through the chain against a local fake of the API (no network).
- A pack check: the bundled recipe is in the published `webveil` tarball.
- Changesets: `webveil` minor ("the default backend is searchcast with a bundled Marginalia chain; set `backend: \"searxng\"` for the previous default") and `pi-webveil` minor (works after one install).

## Acceptance criteria

- [ ] Fresh config: searchcast backend, bundled Marginalia chain, `direct` egress (tested); user engines replace it (tested).
- [ ] No trust rule relaxed (project config still cannot add code recipes; tested).
- [ ] No silent fallback when the library is missing (tested).
- [ ] The bundled file ships in the tarball; README and error/doctor hints updated; the gate is green.

## Blocked by

- rename-serpcast-spellings

## Prompt

Goal: `pi install npm:pi-webveil` (or `npm install -g webveil`) and search works, with no service, account or extra install, and nothing less private than today's default. Read `packages/webveil/src/core/config.ts` (DEFAULTS), the searchcast backend, `work/notes/ideas/default-backend-policy-account-vs-origin.md`, and searchcast's `examples/recipes/marginalia.mjs` (https://github.com/wighawag/searchcast/blob/main/examples/recipes/marginalia.mjs).

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-backend`)

- Versions move only through `.changeset/*.md` (minor for `webveil`, and for `pi-webveil` when its published content changes); never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: the SSRF guard (every redirect, every hop), the trust layers (project `webveil.json` cannot set code, library paths, programs to run, or egress-weakening settings), per-identity state, egress on every hop, strict impersonation, no runtime download. Gate-3 checks each is still tested.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders), except the Marginalia example the owner approved.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No live network calls in tests.
