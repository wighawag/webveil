---
title: searchcast browser fallback in the serpcast backend, with trust, per-identity profile and the external-endpoint egress guard
slug: searchcast-fallback-and-guard
spec: serpcast-backend
blockedBy: [identity-partitioned-state-store]
covers: [6, 7, 13]
---

## What to build

The `serpcast` config section gains a `searchcast` subsection: `library` mode (serpcast starts searchcast in-process with webveil's backend-hop egress as the browser's proxy, plus optional chrome path, xvfb path and extra chrome args) or `endpoint` mode (a `searchcast serve` URL or Unix socket the user runs). searchcast recipes can then appear in the engine list, typically last.

- **Trust.** The chrome path, the xvfb path and the extra chrome args make webveil launch programs, so they are executable keys, refused from a project `webveil.json` like code recipes.
- **Per-identity browser profile.** A persistent browser profile keeps cookies, so it must never be shared across identities. In `library` mode the profile is either ephemeral (the default) or, when persistence is enabled, a directory inside the identity's state partition from `identity-partitioned-state-store`, so a different egress always gets a different profile. There is no setting that points two identities at one profile. A persistent profile keeps browser cookies, so it follows the same idle expiry as sessions: when the partition has been idle longer than `sessionIdleMs`, the profile directory is deleted before the browser starts.
- **Guards** (fail loud where the backend is constructed): a non-direct egress with `endpoint` mode is refused (webveil cannot proxy a browser it does not run, the same trap as a local SearXNG); in `library` mode a SOCKS egress URL carrying credentials is refused (Chromium does not support SOCKS authentication).
- **Lifecycle.** A library-mode browser belongs to the cached serpcast instance and is closed with it (process exit, or the end of a one-shot CLI command).

The `searchcast` package stays optional for webveil users who do not use this mode.

## Acceptance criteria

- [ ] `library` mode passes the egress to searchcast as its proxy (tested with a fake serpcast that records the options it was built with).
- [ ] Chrome path, xvfb path and chrome args from a project `webveil.json` are refused with the file and key named; from global config or env they are used.
- [ ] `library` mode defaults to an ephemeral profile; with persistence enabled, the profile path is inside the identity partition and differs for a different egress.
- [ ] A persistent profile idle longer than `sessionIdleMs` is deleted before the next browser start.
- [ ] `endpoint` mode with `egress: direct` works; with `http`/`socks5` egress it is refused with an explanation.
- [ ] `library` mode with a credentialed SOCKS URL is refused with an explanation.
- [ ] Without searchcast installed, `library` mode fails with a message naming the package.
- [ ] Tests cover the new behaviour; no browser is launched in `verify`; the state dir is isolated in a temp dir and the real one asserted untouched.

## Blocked by

- identity-partitioned-state-store (serialized: config and backend modules; also provides the partition directory)
- External: serpcast task `searchcast-engine` released.

## Prompt

Goal: the real-browser fallback, following the same egress, trust and identity rules as everything else (ADR 0004). Under anonctl the user runs `egress: direct` and the account's traffic is already forced, so both modes work there without extra settings. Test against a fake serpcast built through webveil's own seam (the module that constructs serpcast), not through a serpcast internal.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
