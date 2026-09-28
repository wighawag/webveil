---
title: serpcast code recipes, accepted only from env or the global config
slug: serpcast-code-recipes-trusted
spec: serpcast-backend
blockedBy: [serpcast-backend-basic]
covers: [3, 13]
---

## What to build

The `serpcast` config section gains `codeRecipes`: paths to JS modules or directories of them, loaded with serpcast's `loadCodeRecipe` and usable in the engine list like declarative recipes. `serpcast.codeRecipes` is added to the trust check's executable keys, so code recipe paths coming from a project `webveil.json` are refused with the file named, while paths from the global config or env work. Because sections merge key by key, a project config that sets other `serpcast` keys (for example the engine order) keeps the global `codeRecipes`. Private recipes live wherever the user keeps them (for example under `~/.config/webveil/`), never in a repo.

## Acceptance criteria

- [ ] Code recipe paths from global config or env load and run in the chain.
- [ ] Code recipe paths from a project `webveil.json` are refused before any module is imported (asserted: a module with an import-time side effect is not executed).
- [ ] A project `webveil.json` that sets only `serpcast.engines` keeps the global `serpcast.codeRecipes`, and can list those recipes in its engine order.
- [ ] README documents where private recipes go and why a project config cannot name them.
- [ ] Tests cover the new behaviour; the global config dir is isolated in a temp dir and the real one asserted untouched.

## Blocked by

- serpcast-backend-basic
- External: serpcast task `code-recipes` released (`loadCodeRecipe` available). Promote this task from backlog only after that release.

## Prompt

Goal: private engines (challenge handling, sites with restrictive terms) plug in as files, without opening a code-execution path through project config (ADR 0004). Reuse the trust check from `config-trust-layers`; do not add a second one.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
