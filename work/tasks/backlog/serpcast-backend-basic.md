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
