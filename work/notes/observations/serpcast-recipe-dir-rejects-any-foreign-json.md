---
title: A serpcast recipe directory fails whole if it holds any non-recipe JSON
slug: serpcast-recipe-dir-rejects-any-foreign-json
---

2026-09-29, seen while building `serpcast-backend-basic`: serpcast-recipe's `loadRecipes` reads every `*.json` in a directory, so pointing `serpcast.recipes` at a folder that also holds another JSON file (for example the project's own `webveil.json`, via `"recipes": ["."]`) fails every search with a recipe validation error naming that file. Worth a line in the user docs (task `docs-serpcast-backend`): keep recipes in their own directory.
