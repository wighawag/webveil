---
title: README and CONTEXT for the serpcast backend (quick start without SearXNG, anonymity section)
slug: docs-serpcast-backend
spec: serpcast-backend
blockedBy: [searchcast-fallback-and-guard, refuse-proxy-overriding-chrome-args]
covers: [18]
---

## What to build

The user-facing documentation pass once the serpcast backend is complete. README: a quick start that needs no SearXNG (install webveil, install libcurl-impersonate via serpcast's command or point at your own, drop recipes in a directory, set `backend: serpcast`); the anonymity section updated so it says that with this backend the search hop is webveil's own and `egress` governs it, that the loopback guard concerns SearXNG and the new external-searchcast guard, and how this looks under anonctl (`egress: direct`, forced account); a pointer to where private recipes go. CONTEXT.md: backend list, domain terms (serpcast, recipe, engine chain, identity partition, trusted layer), LOC table. The idea note `work/notes/ideas/expand-search-backend-roster.md` is trimmed to what remains open.

> FORWARD-NOTE (conductor, 2026-09-29): observation `work/notes/observations/serpcast-recipe-dir-rejects-any-foreign-json.md` (from `serpcast-backend-basic`): `serpcast.recipes` directories fail whole if they contain any non-recipe `*.json` (for example the project's `webveil.json` via `"recipes": ["."]`). Say in the quick start to keep recipes in their own directory, then delete that observation. The quick start's libcurl step is `npx serpcast install-libcurl` (released in `serpcast@0.1.0`).

> FORWARD-NOTE (conductor, 2026-09-29, from Gate-3 of `searchcast-fallback-and-guard`): document browser engines as `searchcast:<recipe>` entries in `serpcast.engines`, the `serpcast.searchcast.mode` (`library` default, `endpoint`), and two limitations: a persistent browser profile (`persistProfile`) must not be used by two webveil processes of the same identity at once (observation `searchcast-persistent-profile-concurrent-processes.md`, keep it), and `searchcast` must be installed alongside webveil for library mode (observation `searchcast-not-declared-as-optional-peer.md`, keep it). Proxy-related `chromeArgs` are refused (task `refuse-proxy-overriding-chrome-args`, built before this one).

## Acceptance criteria

- [ ] A new user can go from install to a first serpcast search by following the README alone.
- [ ] The anonymity table has a row for the serpcast backend and no longer implies SearXNG is the only keyless path.
- [ ] CONTEXT.md matches the code (backend list, LOC table).
- [ ] No em dash characters in new or edited text; new or rewritten paragraphs are single lines (untouched hard-wrapped paragraphs stay as they are).

## Blocked by

- searchcast-fallback-and-guard
- External: serpcast task `libcurl-install-and-doctor` released (the quick start uses `serpcast install-libcurl`).

## Prompt

Goal: make the documented rules match the behaviour (spec story 18). Read ADRs 0003 and 0004 and the finished backend code; document what exists, not what the spec planned.

FIRST, check this task against current reality (launch snapshot; may have drifted).

## Decisions

- **Placeholder recipe in the quick start.** The spec says public example recipes live in serpcast, but none exist, and serpcast's own policy is not to publish recipes for real sites. So step 3 shows a `search.example` template, points to the recipe format and to `serpcast query` for testing a recipe on its own. The alternative was shipping a recipe for a real site, which the spec rules out and which raises terms-of-use questions. This affects the "a new user can reach a first search from the README alone" criterion, and is recorded in the new observation note.
- **The quick start uses the global config, not a project `webveil.json`.** This keeps recipes next to where private code recipes must live and away from the project-folder JSON problem. `WEBVEIL_BACKEND=serpcast` is mentioned as an alternative.
- **No invented ceilings.** The modules added to CONTEXT.md's LOC table are marked `-` (no target) rather than given new limits. Setting them is left to a human.
