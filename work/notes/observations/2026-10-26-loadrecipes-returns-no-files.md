---
title: "@searchcast/recipe's loadRecipes returns no recipe files, so webveil still lists recipe directories itself"
slug: loadrecipes-returns-no-files
---

Observed 2026-10-26 (task `drop-recipe-metadata-workaround`). `loadRecipes` (`@searchcast/recipe/node` 0.1.1) returns `Map<name, Recipe>` without each recipe's file, and its directory rule (`isListedRecipeFile`) is not exported, so webveil's `declarativePaths` (`packages/webveil/src/core/backends/searchcast.ts`) still mirrors that rule to let `webveil doctor` report each recipe's file. An upstream export (the listing rule, or a loader that returns files) would let webveil drop the copy; the decision is recorded in the searchcast.ts header comment.
