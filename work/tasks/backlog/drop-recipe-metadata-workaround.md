---
title: Drop the recipe-set metadata workaround once @searchcast/recipe skips it
slug: drop-recipe-metadata-workaround
blockedBy: [loc-table-generated]
covers: []
---

## What to build

webveil's searchcast backend filters `manifest.json` and hidden files out of recipe directories itself (`declarativePaths`), because `loadRecipes` used to load them as recipes. Once searchcast ships the fix (task `load-recipes-skips-set-metadata` in the searchcast repo), bump `searchcast` and `@searchcast/recipe` to that release and remove the workaround, relying on `loadRecipes` for directories. Behaviour for users is unchanged.

## Acceptance criteria

- [ ] Dependencies point at the searchcast release containing the fix.
- [ ] The workaround is removed; an installed set (with `manifest.json` and `.source.json`) still loads, tested.
- [ ] `pnpm loc` re-run; a patch changeset.

## Blocked by

- loc-table-generated
- External: the searchcast release that contains `load-recipes-skips-set-metadata`.

## Prompt

Origin: observation `serpcast-loadrecipes-reads-set-metadata-as-recipes` (delete it once resolved). Check the released `@searchcast/recipe` behaviour first; if it differs from what this task assumes, route to needs-attention.

FIRST, check this task against current reality (launch snapshot; may have drifted).
