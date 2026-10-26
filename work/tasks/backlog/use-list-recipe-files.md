---
title: List recipe directories with @searchcast/recipe's listRecipeFiles instead of a copy of its rule
slug: use-list-recipe-files
blockedBy: [state-clear-keeps-owned-profile]
covers: []
---

## What to build

The searchcast backend's `declarativePaths` repeats `@searchcast/recipe`'s directory rule (skip hidden files and `manifest.json`) so `webveil doctor` can report each recipe's file. Once `listRecipeFiles` is published, bump `@searchcast/recipe` to that release and replace the copy with a call to it. Behaviour, including `doctor`'s per-file report, is unchanged.

## Acceptance criteria

- [ ] `@searchcast/recipe` points at the release with `listRecipeFiles`; the local filter is gone.
- [ ] Recipe directories, installed sets and explicit files load and report exactly as before (existing tests pass).
- [ ] `pnpm loc` re-run; the decision comment in the backend updated; a patch changeset.

## Blocked by

- state-clear-keeps-owned-profile (serialized: README, changesets)
- External: the `@searchcast/recipe` release containing searchcast task `export-list-recipe-files`.

## Prompt

Origin: observation `2026-10-26-loadrecipes-returns-no-files` (delete it once resolved). Check the published package exports `listRecipeFiles` with the behaviour this task assumes; if not, route to needs-attention.

FIRST, check this task against current reality (launch snapshot; may have drifted).
