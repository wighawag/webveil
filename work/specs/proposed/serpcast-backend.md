---
title: serpcast backend, keyless search with no SearXNG, where webveil's egress really is the search egress
slug: serpcast-backend
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked.)

## Problem Statement

webveil's only account-free source of real web results is SearXNG, which the user must install, configure (JSON format, limiter) and run. That is the main setup hurdle, and it also splits the anonymity story: a local SearXNG searches from its own process, so webveil's egress does not cover the search hop, and the README needs a table and a fail-loud guard to stop users from believing otherwise.

serpcast (sibling repo, `wighawag/serpcast`) now provides keyless search engines as a Node library: recipes run over HTTP with the same browser fingerprint SearXNG's curl_cffi produces, an ordered engine chain, and a fallback to searchcast (a real browser). It is deliberately policy-free: the caller injects the proxy, the state store and the recipe set. webveil needs to become that caller, and to add the policy serpcast leaves out.

A second problem surfaces with it: webveil resolves config by walking up from the cwd, so a `webveil.json` in a cloned repository is read automatically. Today the `custom` backend's command comes from config, so a hostile repository can make webveil execute a command the first time an agent searches there. Code recipes would widen that hole unless trust is enforced.

## Solution

A new `serpcast` backend in webveil's registry. With it, the search hop is webveil's own hop, so `egress` governs the traffic that actually reaches the search engines, and `egress: socks5` really anonymizes search. Installing webveil installs serpcast; searchcast is only needed for the browser fallback.

webveil adds the policy serpcast leaves to its caller:

- **Egress**: pass the backend-hop egress to serpcast as its proxy, and to searchcast when webveil runs it in-process. Under anonctl (the common anonymous setup) the account's traffic is already forced, so the user runs `egress: direct`, and nothing extra happens.
- **State**: a file-backed store under `$XDG_STATE_HOME/webveil/`, partitioned per identity, so the one-shot CLI keeps sessions and cooldowns between calls and no state ever crosses identities.
- **Trust**: executable configuration (code recipe paths, the `custom` backend command) is accepted only from trusted layers (env and the global config), never from a project `webveil.json`.
- **Strict impersonation**: webveil always runs serpcast in strict mode; no fingerprint, no search.

## User Stories

1. As a webveil user, I want `backend: "serpcast"` to give me keyless web search with no SearXNG, so that webveil is the only thing I install.
2. As a webveil user, I want to configure an ordered list of engines (declarative recipes, code recipes, searchcast recipes), so that I control which engines are tried and in which order.
3. As a webveil user, I want to point webveil at a directory of recipes, including private ones kept outside any repo, so that adding an engine means dropping in a file.
4. As a privacy-conscious user, I want `egress: socks5` (or `http`) to carry ALL serpcast engine traffic, including code recipes, so that with this backend webveil's egress really is my search egress.
5. As an anonctl user, I want `egress: direct` to work with no extra configuration, because the account's traffic is already forced through the tunnel.
6. As a webveil user, I want the browser fallback to use searchcast, either run by webveil in-process with webveil's egress passed as its proxy, or reached over a searchcast socket I run myself, so that the browser engine follows the same egress rules.
7. As a privacy-conscious user, I want webveil to refuse a non-direct egress combined with an external searchcast endpoint it cannot proxy (the same trap as a local SearXNG), with an error that explains why, so that I never get false anonymity.
8. As a CLI user, I want sessions (clearance cookies, challenge tokens) and engine cooldowns to persist between `webveil search` calls, so that the one-shot CLI behaves like the long-lived MCP server and pi extension.
9. As a privacy-conscious user, I want persisted state partitioned by identity (the resolved egress and the config that selected it), so that a session obtained on one egress is never replayed on another, which would link the two identities.
10. As a privacy-conscious user, I want persisted sessions to keep their idle expiry (dropped after the configured idle time, checked on load), so that saving state to disk does not let cookies link searches across days.
11. As a CLI user, I want concurrent `webveil search` calls to share the state file safely (locking, atomic writes), so that parallel agents do not corrupt it.
12. As a user, I want a command to clear the state (all identities or the current one), so that I can drop sessions on demand.
13. As a user, I want code recipe paths and the `custom` backend command to be accepted only from env or the global config, with a clear error naming the offending project `webveil.json` otherwise, so that cloning a repository can never make webveil run code.
14. As a user, I want this trust rule documented in the README next to the per-folder config explanation, so that I know what a project config can and cannot do.
15. As a user, I want webveil to fail loud when serpcast reports impersonation is not active (missing or wrong libcurl-impersonate), with the fix in the message (the serpcast install command or the library path setting), so that I never search with a non-browser fingerprint.
16. As a user, I want per-engine failures surfaced in the result, like SearXNG's `unresponsiveEngines` today, so that the agent knows when the answer came from a fallback or when all engines failed.
17. As a user, I want a total failure (every engine failed) to be an error listing each engine's typed failure, never an empty result list, so that "blocked" is never read as "nothing found".
18. As a user, I want the README's anonymity section updated for this backend (the search hop is webveil's own; the loopback guard is about SearXNG and external searchcast only), so that the documented rules match the behaviour.
19. As an existing user, I want the default backend and every existing config to keep working unchanged, so that adding serpcast breaks nothing.

### Autonomy notes

- `humanOnly`: not set.
- `needsAnswers`: not set. The spec is fully decided, but it depends on serpcast's first release (a cross-repo dependency `taskedAfter` cannot express). Keep it in `specs/proposed/` until serpcast 0.1.0 is published, then promote.

## Implementation Decisions

- **Backend**: `createSerpcastBackend(config)` registered as `serpcast` in the backend registry. It maps serpcast results to `SearchResult` (`snippet` from the recipe's content field), and the failures of engines tried before the answering one to `unresponsiveEngines`. `fetch` is not provided by this backend; `web_fetch` stays on the undici path with the SSRF guard (a separate decision later, if fetch should also use the impersonated transport).
- **Config** (names decided at tasking, shape decided here): a `serpcast` section with the ordered engine list, recipe directories, code recipe paths (trusted layers only), the searchcast mode (`library` with optional chrome/profile settings, or `socket` with a path/URL), the libcurl-impersonate path, session idle time and cooldown. Env equivalents for the scalar settings.
- **Egress mapping**: the backend-hop `egress` becomes serpcast's proxy URL (`direct` means none). The loopback-`baseUrl` guard does not apply to this backend (there is no `baseUrl`); a new guard rejects non-direct egress with searchcast in `socket` mode. When searchcast runs in-process, its proxy is the same URL (note: Chromium does not support SOCKS with authentication; fail loud if the egress URL carries credentials in that mode).
- **Trust policy**: the config layer records which layer each key came from. Keys that make webveil execute code (serpcast code recipe paths, `custom`'s command) are rejected when they come from a project `webveil.json`. Declarative recipes are allowed from a project config (they can only send the query to a URL, which a project config can already do today through `baseUrl`).
- **State store**: implements serpcast's store interface on files under `$XDG_STATE_HOME/webveil/` (default `~/.local/state/webveil/`). One partition per identity key, derived from the resolved egress (mode + URL) and the resolved backend config, hashed so no URL or credential appears in the path. Advisory file locking plus atomic replace. Expiry is enforced on read. File permissions 0600, directories 0700.
- **Strict mode** always on when webveil builds serpcast.
- **ADR**: record "the engine layer lives in serpcast, webveil injects egress, state and trust" alongside ADR 0001 (distilly), since it is the same mechanism/policy split.
- **Docs**: README (backend list, quick start without SearXNG, anonymity table, trust rule, state location) and CONTEXT.md (backend list, LOC table, the state and trust terms).

## Testing Decisions

- Backend tests inject a fake serpcast (or a serpcast with fake engines) and assert: egress passed as proxy, strict mode on, result and failure mapping, total failure is an error.
- Trust tests: code recipe path or custom command from a project `webveil.json` is rejected with the file named; the same from global config or env is accepted.
- State store tests: partitions differ for different egress; expiry enforced on read; concurrent writers from two processes do not corrupt the file; the clear command removes the right partition.
- Guard test: non-direct egress with searchcast `socket` mode is rejected.
- No live engine traffic in `verify`.

## Out of Scope

- Engine recipes themselves (public examples live in serpcast; private ones outside any repo).
- Routing `web_fetch` through the impersonated transport.
- Removing the SearXNG or tavily-compat backends.
- Changing the default backend. Whether `serpcast` should become the default is a later decision, once recipes and libcurl installation are proven.

## Further Notes

- Depends on the serpcast spec (`wighawag/serpcast`, `work/specs/proposed/serpcast.md`) and serpcast's first release.
- Supersedes the former idea note `playwright-search-backend` (deleted; searchcast is the browser part). `work/notes/ideas/expand-search-backend-roster.md` is partly answered by this spec.
