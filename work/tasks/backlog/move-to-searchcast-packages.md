---
title: Depend on searchcast 0.2, @searchcast/recipe and @searchcast/browser instead of serpcast, serpcast-recipe and searchcast 0.1
slug: move-to-searchcast-packages
spec: searchcast-backend
blockedBy: []
covers: [1, 4, 5]
---

## What to build

Swap the packages, not yet the user-facing spellings (the next task renames those).

- `packages/webveil` depends on `searchcast` `^0.2.0` (was `serpcast` `^0.6.0`) and `@searchcast/recipe` `^0.1.0` (was `serpcast-recipe` `^0.2.0`). The optional peer `searchcast >=0.1.1` becomes `@searchcast/browser` `>=0.1.0 <0.2.0` (optional); webveil's own import of the browser runner (the `importSearchcast` seam in the serpcast backend) imports `@searchcast/browser`, and its "not installed" message names `@searchcast/browser` and its install line.
- Code uses searchcast's new API names (`createSearchcast`, `SearchcastError`, `SearchcastOptions`, ...), not the deprecated `Serpcast*` aliases, and `searchcast/install` instead of `serpcast/install`.
- Recipe sets (`set:<name>`) are found through searchcast's `recipeSetDir` (new data dir `$XDG_DATA_HOME/searchcast/recipes`, falling back to the old `serpcast` one), so a set installed by serpcast keeps working. webveil's `install-recipes`/`install-libcurl` write only to the new data dir (they call searchcast's installers). `webveil doctor` shows searchcast's old-data-dir notice (`oldDataDir`/`oldDataDirHits`, with the `mv` command) and the library source, which is now usually `the platform package @searchcast/libcurl-<platform>`.
- The library: with searchcast's platform packages, `install-libcurl` is only needed where the optional dependency was skipped or the platform has none. The docs and the `setup`/install hints say so. `WEBVEIL_SERPCAST_LIBCURL_PATH` and the `libcurlPath` setting keep their meaning (renamed in the next task).
- Identity keys (docs/adr/0004, `identity.ts`) of an unchanged config stay the same, except where a resolved `set:` path now points to the new data dir (state may reset once; it is short-lived). Say so in the changeset.
- Tests: every existing test passes against the new packages (fakes and seams renamed as needed, nothing weakened); a test that webveil imports no `serpcast` or `serpcast-recipe` module; the missing-browser message.
- Changeset: `webveil` minor (the dependency move, the peer rename, installs brought by searchcast's platform packages).

## Acceptance criteria

- [ ] No `serpcast` or `serpcast-recipe` dependency, import or lockfile entry; the browser peer is `@searchcast/browser`.
- [ ] Old recipe sets are still found; installers write only to the new data dir (tested with temp `XDG_DATA_HOME`, real one untouched).
- [ ] doctor reports the library source and the old-data-dir notice.
- [ ] All security tests unchanged in strength; the gate is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: webveil runs on the renamed packages with identical behaviour. Read searchcast's README ("Upgrading from serpcast") and its ADR 0005 (https://github.com/wighawag/searchcast/blob/main/docs/adr/0005-serpcast-renamed-to-searchcast-browser-runner-becomes-searchcast-browser.md), and in this repo `packages/webveil/src/core/backends/serpcast.ts`, `fetch-transport.ts`, `state.ts`, `setup.ts`.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-backend`)

- Versions move only through `.changeset/*.md` (minor for `webveil`, and for `pi-webveil` when its published content changes); never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: the SSRF guard (every redirect, every hop), the trust layers (project `webveil.json` cannot set code, library paths, programs to run, or egress-weakening settings), per-identity state, egress on every hop, strict impersonation, no runtime download. Gate-3 checks each is still tested.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders), except the Marginalia example the owner approved.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No live network calls in tests.
