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

## Decisions

These are recorded in the header comment of `src/core/backends/searchcast.ts` (the decision for task drop-recipe-metadata-workaround).

1. **I didn't switch to `loadRecipes` itself.** It returns only the recipes, not the file each came from, and `webveil doctor` reports each recipe's file (tests check this in `setup.test.ts`). So webveil still lists a directory's files, now with exactly the library's rule and no set detection, then loads each with `loadRecipeFile`. I rejected two other options:
   - load with `loadRecipes` and show the directory as the file, which changes doctor's output;
   - work out the file from the recipe's name, which is wrong when a recipe's JSON declares a different name.

   The cost is that webveil keeps a copy of the library's rule. The new observation suggests searchcast export the rule, or a loader that returns files, so the copy can go.
2. **Small change for directories that aren't sets:** their `manifest.json` and hidden `*.json` files are now skipped too, the same as `searchcast serve --recipes <dir>` does. Before, only sets skipped them. Installed sets load as before.
