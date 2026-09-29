---
title: serpcast code recipes, accepted only from env or the global config
slug: serpcast-code-recipes-trusted
spec: serpcast-backend
blockedBy: [serpcast-backend-basic]
covers: [3, 13]
---

## What to build

The `serpcast` config section gains `codeRecipes`: paths to JS modules or directories of them, loaded with serpcast's `loadCodeRecipe` and usable in the engine list like declarative recipes. `serpcast.codeRecipes` is added to the trust check's executable keys, so code recipe paths coming from a project `webveil.json` are refused with the file named, while paths from the global config or env work. Because sections merge key by key, a project config that sets other `serpcast` keys (for example the engine order) keeps the global `codeRecipes`. Private recipes live wherever the user keeps them (for example under `~/.config/webveil/`), never in a repo.

> FORWARD-NOTE (conductor, 2026-09-28, from Gate-3 of `config-trust-layers`, PR #12): the trust helper (`core/trust.ts`) reads provenance from a non-enumerable symbol on the resolved `Config`, and a config with NO provenance is treated as trusted (code-built). A spread copy (`{...config}`) DROPS provenance, so the check then silently passes (fails OPEN). Every config you derive before an executable-setting consumer must go through `carryProvenance(from, to)` (`core/layers.ts`), and a test must prove a project-set executable key is still refused on the derived path. Register this backend's executable keys with `assertTrusted` at USE time (not construction), and resolve paths only through `resolveExecutablePath` (never the cwd).

> FORWARD-NOTE (conductor, 2026-09-29): serpcast's `loadCodeRecipe(path)` resolves a relative path against the process cwd and imports (runs) the module immediately. Pass only paths already resolved by `resolveExecutablePath` (absolute), and run the trust check BEFORE `loadCodeRecipe` is called, never after.

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

## Decisions

These are recorded as comments where each choice is made; please link them from the done record.
1. **Env form** (`config.ts`, comment on `SerpcastConfig`): `WEBVEIL_SERPCAST_CODE_RECIPES` is a list split on `:` (`;` on Windows), like `PATH`, and each entry must be absolute or `~/`. It is the only list setting with an env form. Without it, env could never supply a code recipe path, which the first acceptance criterion requires. I considered a JSON array in env and rejected it as awkward to type in a shell.
2. **What a directory loads** (`config.ts`): every `*.js` and `*.mjs` file, sorted, matching how `loadRecipes` picks up `*.json`. `.cjs` and `.ts` files are not loaded.
3. **One name space** (`serpcast.ts` header): code and declarative recipes share names, and a name used twice (across kinds or within one) is an error rather than a silent override, as `loadRecipes` already does for JSON recipes.
4. **Import on every search** (`serpcast.ts` header): each listed module is imported on every search. Node's module cache makes repeats cheap, and a recipe's engine name is only known after importing it. Recipe paths are part of the resolved section, so they also count towards the identity key without any extra code.

No observation notes were added.
