---
title: README and CONTEXT for the serpcast backend (quick start without SearXNG, anonymity section)
slug: docs-serpcast-backend
spec: serpcast-backend
blockedBy: [searchcast-fallback-and-guard]
covers: [18]
---

## What to build

The user-facing documentation pass once the serpcast backend is complete. README: a quick start that needs no SearXNG (install webveil, install libcurl-impersonate via serpcast's command or point at your own, drop recipes in a directory, set `backend: serpcast`); the anonymity section updated so it says that with this backend the search hop is webveil's own and `egress` governs it, that the loopback guard concerns SearXNG and the new external-searchcast guard, and how this looks under anonctl (`egress: direct`, forced account); a pointer to where private recipes go. CONTEXT.md: backend list, domain terms (serpcast, recipe, engine chain, identity partition, trusted layer), LOC table. The idea note `work/notes/ideas/expand-search-backend-roster.md` is trimmed to what remains open.

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
