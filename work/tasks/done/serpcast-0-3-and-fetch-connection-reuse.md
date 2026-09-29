---
title: Adopt serpcast 0.3 (coherent sec-fetch-site), and reuse web_fetch connections per egress with an empty cookie jar per fetch
slug: serpcast-0-3-and-fetch-connection-reuse
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

1. **serpcast `^0.3.0`** (released 2026-09-29: `sec-fetch-site`, `referer`, `origin` and `sec-fetch-storage-access` now follow Chromium for same-site and cross-site subresources, measured). Lockfile, `minimumReleaseAgeExclude`, changeset. Check nothing in webveil depends on the old always-`same-origin` behaviour.
2. **`web_fetch` connection reuse** (owner decision 2026-09-29). Today the `fetchTransport: serpcast` path gives every fetch its own transport session and closes it, so every fetch pays a new TCP + TLS setup (over Tor about 0.5 s versus about 0.09 s on a reused serpcast session, measured). Keep connections open across fetches of the same fetch identity (the fetch-hop egress + library path, the existing transport cache key), but NEVER carry cookies from one fetch to another: each fetch starts with an empty cookie jar (redirect hops inside one fetch still share its cookies, as today). Concurrent fetches must not see each other's cookies: use a small pool of sessions per identity (a fetch takes an idle session, clears its cookies, uses it, clears again, returns it; a busy session is never shared), or another design with the same guarantee, recorded. Idle sessions are closed after a period (record it, for example serpcast's session idle default) and by `closeBackends`; nothing may keep the one-shot CLI alive.
   The trade-off to record in the README (fetch section): a site sees repeated fetches to it arrive on one TLS connection, which links them at the connection level; through a single proxy or Tor circuit they already share an exit IP, and no cookie or state is carried.

## Acceptance criteria

- [ ] serpcast `^0.3.0`; all existing tests pass.
- [ ] Two sequential fetches with the same identity reuse one session (and so its connections), asserted through the fake transport; a different egress never shares; each fetch starts with no cookies even when the previous fetch received some (tested); two concurrent fetches get different sessions (tested).
- [ ] Idle sessions are released on a timer and by `closeBackends`; the one-shot CLI still exits on its own (existing test).
- [ ] README fetch section updated with the trade-off; changeset.

## Blocked by

- None, can start immediately.

## Prompt

Read `core/fetch-transport.ts` and serpcast 0.3's `TransportSession` (`clearCookies`, `close`). FIRST, check this task against current reality. RECORD non-obvious decisions.

## Decisions

All recorded in the "Recorded decisions (task serpcast-0-3-and-fetch-connection-reuse)" comment at the top of `packages/webveil/src/core/fetch-transport.ts`.
1. **A pool rather than one shared session.** One shared session was rejected because two concurrent fetches would share, and clear, one cookie jar.
2. **At most 4 idle sessions per identity** (`MAX_IDLE_SESSIONS`); extras are closed when returned. The task didn't ask for a cap. It limits how many connections stay open after a burst of concurrent fetches, and I didn't make it configurable.
3. **Idle sessions close after 10 minutes,** serpcast's own session idle default (`DEFAULT_SESSION_IDLE_MS`). There is no config key, the same as the existing timeout and size limits.
4. **A failed fetch closes its session instead of returning it.** This covers errors, timeouts, aborts, a hop refused by the SSRF check, and too many redirects, so a broken or half-finished connection is never handed to the next fetch.
5. **This reverses the serpcast-0-2-decoy-guard decision** (one session per fetch), per the owner's decision of 2026-09-29. I replaced that old comment with the new decisions block, which says it is a reversal.

No out-of-scope issues noticed, and I made no git operations; the working tree holds only this task's changes.
