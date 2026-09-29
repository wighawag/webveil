---
title: Adopt serpcast 0.2 (connection reuse, decoy guard) and expose `serpcast.decoyGuard`
slug: serpcast-0-2-decoy-guard
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

serpcast 0.2.0 (released 2026-09-29) adds two things webveil should pick up:

- **Connection reuse inside a transport session** (keep-alive, one multi handle per session, never shared across sessions; the chain keeps each engine's session between searches and closes it on idle expiry, `clearSessions`, `close()`). Measured through Tor: about 0.5 s to about 0.09 s per request on a reused session. Nothing to configure; webveil's instance cache already keeps one serpcast per identity, so reuse follows the identity boundary. Check that `closeBackends` still leaves nothing that keeps the one-shot CLI alive (serpcast says idle sessions hold no Node handle), and that the `web_fetch` serpcast transport (`core/fetch-transport.ts`, one session per request) is unaffected (record whether it should reuse; it deliberately does not carry cookies between fetches, so leave it per request unless there is a clear reason).
- **An opt-in decoy guard**: `createSerpcast({decoyGuard: ['bing', ...]})` checks the named engines' answers with a relevance rule and turns a decoy page (results unrelated to the query, which Bing serves for about half of realistic queries) into a `decoy` failure; the chain moves on, no cooldown. `isDecoy(query, results)` is exported.

Changes:

1. `serpcast` dependency `^0.2.0` (lockfile, and `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` like 0.1.1), changeset (minor: new config key).
2. Config key `serpcast.decoyGuard`: a list of engine names (env `WEBVEIL_SERPCAST_DECOY_GUARD`, comma-separated, like the other list keys), passed to `createSerpcast`. Not executable, allowed from any layer. It is part of the resolved section, so it joins the identity key (record that this is intended: a different guard setting is a different instance, harmless).
3. A `decoy` failure shows in `unresponsiveEngines` like other failures, and in the `exhausted` error text with its kind. Make sure nothing in webveil switches on the error kind in a way that treats an unknown kind badly.
4. README: the key, the rule in one sentence, and a note that it is meant for engines known to serve decoys (Bing); CONTEXT.md if it lists serpcast kinds.

## Acceptance criteria

- [ ] `serpcast.decoyGuard` reaches `createSerpcast` (tested with the fake serpcast), from global, project and env; invalid values (not a list of strings) fail loud.
- [ ] A fake engine answering a decoy under the guard falls through to the next engine and appears in `unresponsiveEngines`; all engines failing reports the decoy in the error.
- [ ] The one-shot CLI still exits on its own after a search (existing test), and all existing tests pass.
- [ ] README updated; changeset added.

## Blocked by

- None, can start immediately.

## Prompt

FIRST, check this task against current reality (serpcast 0.2.0's README and types). RECORD non-obvious decisions.
