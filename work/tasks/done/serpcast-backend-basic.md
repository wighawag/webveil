---
title: `serpcast` backend with declarative recipes, egress as a remote-DNS proxy, strict impersonation, cached instance
slug: serpcast-backend-basic
spec: serpcast-backend
blockedBy: [config-trust-layers]
covers: [1, 2, 3, 4, 5, 15, 16, 17, 19]
---

## What to build

A new `serpcast` entry in the backend registry. Config gains a `serpcast` section (merged key by key across layers, see `config-trust-layers`): the ordered engine list, recipe directories (declarative recipes, allowed from any layer), the libcurl-impersonate path, session idle time and cooldown, with env equivalents for scalar settings (`WEBVEIL_SERPCAST_*`). The libcurl path is executable (it is loaded as native code), so it is added to the trust check's executable keys and refused from a project `webveil.json`.

The backend-hop `egress` becomes serpcast's proxy URL, mapped so DNS stays at the proxy exactly as webveil's own SOCKS path does today (finding `socks5-egress-behaviour-in-webveil`): `socks5://`, `socks://` and `socks5h://` all become `socks5h://`; `http` passes through; `direct` means no proxy. Strict mode is always on. The loopback-`baseUrl` guard does not apply to this backend (there is no `baseUrl`; the default one is loopback and must not trip the guard).

The backend is currently constructed per search call, so the serpcast instance is cached at module level, keyed by the same identity key the state store will use (a hash of the resolved backend-hop egress and the resolved `serpcast` section), so cooldowns and sessions survive across searches in the MCP server and pi extension. The CLI and `--mcp` share one entry point, so `close()` never runs inside the search command handler (that would defeat the cache under MCP). It runs at process level: in non-`--mcp` mode after the CLI has finished serving the command (or on `beforeExit`), and in the MCP server and pi extension when the process shuts down, so nothing is left running.

Results map to `SearchResult`; the failures of engines tried before the answering one map to `unresponsiveEngines`; a serpcast `exhausted` error becomes an error listing each engine's failure; an `impersonation` error becomes an error whose message includes serpcast's fix (install command or library path setting). State uses serpcast's default in-memory store for now (the file store is a later task). `web_fetch` is unchanged. Existing backends and the default (`searxng`) are untouched.

> FORWARD-NOTE (conductor, 2026-09-28, from Gate-3 of `config-trust-layers`, PR #12): the trust helper (`core/trust.ts`) reads provenance from a non-enumerable symbol on the resolved `Config`, and a config with NO provenance is treated as trusted (code-built). A spread copy (`{...config}`) DROPS provenance, so the check then silently passes (fails OPEN). Every config you derive before an executable-setting consumer must go through `carryProvenance(from, to)` (`core/layers.ts`), and a test must prove a project-set executable key is still refused on the derived path. Register this backend's executable keys with `assertTrusted` at USE time (not construction), and resolve paths only through `resolveExecutablePath` (never the cwd).

> FORWARD-NOTE (conductor, 2026-09-29, from the serpcast build, released as `serpcast@0.1.0`): the released API is `createSerpcast({libcurlPath?, proxy?, strict?, timeoutMs?, store?, cooldownMs?, sessionIdleMs?, searchcast?})` returning `{search(query, {engines, maxResults?, signal?}), clearSessions(engine?), close()}`, where `engines` is an array of engine OBJECTS (declarative `Recipe`s from `serpcast-recipe/node`'s `loadRecipes`, code recipes, browser engines), not names: map webveil's configured engine names to loaded recipes and fail loud on an unknown name. serpcast resolves a RELATIVE `libcurlPath` against the process cwd, so always pass the path already resolved by `resolveExecutablePath` (absolute). An `impersonation` error is thrown on the first search (not at construction). `strict` defaults to true; never pass `strict: false`.

## Acceptance criteria

- [ ] `backend: "serpcast"` with a recipe directory and engine list returns results through the core `search()` in both the CLI/MCP frontend and pi-webveil.
- [ ] Egress mapping: `socks5://`, `socks://` and `socks5h://` egress URLs reach serpcast as `socks5h://` (same host, port and credentials); `http` passes through; `direct` passes no proxy.
- [ ] The default loopback `baseUrl` with a non-direct egress does not trip the loopback guard for this backend.
- [ ] Strict mode is always on; there is no config to turn it off.
- [ ] The libcurl path from a project `webveil.json` is refused with the file named; from global config or env it is used.
- [ ] Two searches with the same config reuse one serpcast instance (a cooldown set by the first is seen by the second), including two calls through the MCP path; a different egress gets a different instance.
- [ ] A one-shot CLI search exits on its own after printing (the instance is closed at process level, not in the handler).
- [ ] Partial failures appear in `unresponsiveEngines`; `exhausted` is an error, never an empty list.
- [ ] Existing configs (searxng, tavily-compat, custom) behave exactly as before.
- [ ] Tests inject a fake serpcast (or serpcast with fake engines); no live engine traffic and no native library needed in `verify`.
- [ ] CONTEXT.md backend list and LOC table updated; README LOC table updated.

## Blocked by

- config-trust-layers (serialized: both edit the config module)
- External: `serpcast` published at a real version with the chain API (serpcast tasks `engine-chain-and-state` and `release-workflow-oidc` done and released). Promote this task from backlog only after that release.

## Prompt

Goal: keyless search with no SearXNG, where webveil's egress is the search egress (ADR 0004). serpcast is policy-free (its ADR 0002): webveil supplies the proxy, the store and the recipes. Read serpcast's README for the API (`createSerpcast`, engines, `SerpcastError` kinds, store interface) and its note on proxy schemes (libcurl resolves DNS locally for `socks5://`, at the proxy for `socks5h://`). Keep the backend module within the size budget in CONTEXT.md.

FIRST, check this task against current reality: in particular that serpcast's released API matches what this task assumes. If it differs, route to needs-attention with the difference. RECORD non-obvious in-scope decisions (for example config key names and the cache key).

## Decisions

I couldn't edit the done record, so each decision is recorded in a comment where the choice is made:
1. **Config key names** (`config.ts`, on `SerpcastConfig`): `engines`, `recipes` (files or directories, to pair with the planned `codeRecipes`), `libcurlPath`, `sessionIdleMs`, `cooldownMs`. Env only covers the three scalar settings. Recipes may come from any layer but resolve relative to the config file that set them. I considered `recipeDirs` but it's too narrow, since single files also work.
2. **Identity and cache key** (`core/identity.ts`): a sha256 of the backend-hop egress plus the whole `serpcast` section with paths resolved. New settings join the identity automatically. I rejected picking a subset of fields, because each new setting would have to remember to join it.
3. **Engine list and empty results** (`serpcast.ts` header): a missing or empty `engines` list is an error rather than "use every loaded recipe", because the order decides which engines get traffic. An empty answer after earlier failures returns `[]`, since that is a genuine "no results".
4. **pi shutdown** (`pi-webveil/src/index.ts`): it closes on every `session_shutdown` reason, not only `quit`. The cost is that in-memory cooldowns reset on `/new` until the on-disk state store lands.
5. **Proxy URL checks** (`serpcast.ts`, `serpcastProxy`): a proxy URL whose scheme doesn't match its mode is refused with `EgressError`. Otherwise an `http` egress pointing at a `socks5://` URL would reach libcurl as-is, and libcurl resolves DNS locally for plain `socks5://`, leaking lookups.
6. **Workspace:** `pnpm-workspace.yaml` gets `allowBuilds: koffi: false` (serpcast's own repo does the same; koffi loads its bundled binaries) and `minimumReleaseAgeExclude` entries for the two serpcast packages. pnpm added the exclusions itself because the releases are newer than its minimum release age, so they're a policy choice for you to confirm or revert.

**Observation note:** `work/notes/observations/serpcast-recipe-dir-rejects-any-foreign-json.md`. Any non-recipe `*.json` in a recipe directory, such as a project's own `webveil.json`, makes every search fail. The docs task should tell users to keep recipes in their own directory.
