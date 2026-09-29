---
title: serpcast-recipe's loadRecipes loads an installed set's manifest.json and .source.json as recipes
slug: serpcast-loadrecipes-reads-set-metadata-as-recipes
---

Observed 2026-09-29 (task `serpcast-0-5-recipes-and-nixos-docs`). In serpcast 0.5.0 / serpcast-recipe 0.2.0, `loadRecipes([dir])` loads every `*.json` in a directory, so pointing it at a set written by `serpcast install-recipes` also parses `manifest.json` and `.source.json` as recipes and fails. webveil works around it (`declarativePaths` in `packages/webveil/src/core/backends/serpcast.ts`); an upstream option or helper in serpcast (for example loading a set by name, skipping its metadata) would let callers drop that. Also, the LOC table in README.md still mixes metrics across rows (see `readme-loc-table-stale-rows.md`); this task only moved the `config.ts` and `serpcast.ts` rows by their non-blank-line delta.
