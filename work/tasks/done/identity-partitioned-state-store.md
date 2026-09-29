---
title: File-backed serpcast state, partitioned per identity, with expiry, locking and a clear command
slug: identity-partitioned-state-store
spec: serpcast-backend
blockedBy: [serpcast-code-recipes-trusted]
covers: [8, 9, 10, 11, 12]
---

## What to build

webveil's implementation of serpcast's state store interface, on files under `$XDG_STATE_HOME/webveil/` (default `~/.local/state/webveil/`), used by the serpcast backend in every frontend so the one-shot CLI keeps sessions and cooldowns between calls. State is partitioned per identity: the partition key is the identity key `serpcast-backend-basic` already uses to cache the serpcast instance (a hash of the resolved backend-hop egress and the resolved `serpcast` section; reuse that one function, do not define a second key), so no URL or credential appears in a path and a session obtained on one egress is never read on another. Expiry is enforced on read, so an idle session is dropped even if the file still holds it. Writes are atomic (write then rename) under an advisory lock, so concurrent CLI processes do not corrupt state. Files are 0600, directories 0700. A CLI command (for example `webveil state clear [--all]`) clears the current identity's partition, or all. The partition directory is exposed to other modules so the browser profile (task `searchcast-fallback-and-guard`) can live inside it.

> FORWARD-NOTE (conductor, 2026-09-29, released `serpcast@0.1.0`): serpcast's `StateStore` is `{get(key): Promise<JsonValue | undefined>, set(key, value, {ttlMs?}): Promise<void>, delete(key): Promise<void>}` (exported types `StateStore`, `JsonValue`), passed as `createSerpcast({store})`. Keys look like `engine/<encoded name>/session`, `engine/<encoded name>/cooldown` and one index key `serpcast/sessions`; never use a key verbatim as a file name without encoding it. serpcast stamps its own times inside values and re-checks them, so lazy expiry is safe, but the task still requires expiry on read. The identity key function is `identityKey(egress, section)` in `core/identity.ts`, reached through `serpcastIdentityKey(config, resolved)` in `core/backends/serpcast.ts`; reuse it.

## Acceptance criteria

- [ ] Two consecutive CLI searches with the same config share session state; a different egress gets a different partition and never sees the first one's data.
- [ ] An entry past its expiry is not returned and is removed.
- [ ] Two processes writing concurrently leave a valid file with both writes applied or one cleanly winning (no corruption).
- [ ] Permissions are 0600/0700; paths contain only the hash.
- [ ] The clear command removes the current partition or all partitions.
- [ ] README (state location, what is stored, the clear command) and CONTEXT.md (state and identity terms) updated.
- [ ] Tests isolate `XDG_STATE_HOME` in a temp dir and assert the real state dir is untouched.

## Blocked by

- serpcast-code-recipes-trusted (serialized: config and backend modules)

## Prompt

Goal: the CLI supports state, without state becoming a tracking vector (ADR 0004). Saving to disk must not extend a session's life beyond its idle expiry, and state must never cross identities: replaying cookies or challenge tokens from one egress on another links the two. Implement serpcast's store interface exactly; do not change serpcast.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions (hash inputs, lock mechanism).
