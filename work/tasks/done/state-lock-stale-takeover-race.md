---
title: Make breaking a stale state lock race-free
slug: state-lock-stale-takeover-race
spec: serpcast-backend
blockedBy: [searchcast-optional-peer-dependency]
covers: []
---

## What to build

`withLock` in `packages/webveil/src/core/state.ts` breaks a lock older than `LOCK_STALE_MS` with check-then-`rm`: two waiters that both see the same stale lock can race, and the second `rm` can delete the lock the first has just taken, so both hold it (noted at Gate-3 of `identity-partitioned-state-store`, PR #17). Replace it with a takeover that cannot remove a lock another process has freshly taken. One approach: the lock file holds a unique token (pid plus random); a waiter that judges it stale renames it to a unique name (`rename` is atomic, so only one waiter wins the rename of that exact file), re-checks that what it renamed is still the stale token it saw (if not, it restores or leaves it and retries), then removes it and competes with `wx` as usual; the holder removes the lock only if it still holds its own token. Any equivalent design is fine if it is atomic on POSIX and on Windows (Node's `rename` semantics there) and adds no native dependency. Record the design.

## Acceptance criteria

- [ ] A deterministic test reproduces the old race (two waiters, one stale lock, interleaving forced through a seam) and shows both would hold the lock before the fix; after the fix exactly one holds it.
- [ ] A holder never deletes a lock it no longer owns (tested).
- [ ] The existing concurrent-process test and the crashed-writer test still pass.
- [ ] No new dependency; `XDG_STATE_HOME` isolated as in the existing state tests.

## Blocked by

- searchcast-optional-peer-dependency (serialized: sequential drive)

## Prompt

FIRST, check this task against current reality. RECORD non-obvious decisions.
