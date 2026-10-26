---
title: Persistent browser profile, idle expiry under the partition lock and safe with concurrent processes
slug: profile-expiry-under-partition-lock
blockedBy: [socks-docs-match-code]
covers: []
---

## What to build

With `searchcast.browser.persistProfile`, the idle check and deletion of the profile (`expireProfile` in the searchcast backend, calling `isProfileIdle` then `deleteProfile`) run without the partition's state lock, so one process can delete a profile another process's browser is still using; and two processes of the same identity point two Chromium instances at one profile, which Chromium's own profile lock refuses. Fix both: the check, delete and touch run as one step under the partition lock (`withLock`); a profile in use by a live browser of another process is never deleted (a marker the running browser holds, for example a lock file with the owner's pid that is checked for liveness, or Chromium's own `SingletonLock`); and when the profile is in use by another process, this process does not fail its search with Chromium's lock error: it falls back to an ephemeral profile for that search and says so once on stderr (or another behaviour you justify and record). The default (ephemeral profile) is unaffected.

## Acceptance criteria

- [ ] Idle check, delete and touch happen under the partition lock (tested by racing two processes or two simulated holders).
- [ ] A profile held by a live browser in another process is not deleted even after the idle time.
- [ ] A second process of the same identity can still search while the first holds the profile, with the documented fallback.
- [ ] README's persistent-profile paragraph states the behaviour.
- [ ] Tests isolate `XDG_STATE_HOME` in a temp dir and assert the real state dir is untouched; no real browser launched in verify.
- [ ] A changeset (patch) for `webveil` and, if behaviour visible there, `pi-webveil`.

## Blocked by

- socks-docs-match-code (serialized: both may edit README and CONTEXT)

## Prompt

Origin: observation `searchcast-persistent-profile-concurrent-processes` (delete it once resolved). Read the state module (lock, partition, profile helpers) and the searchcast backend's browser setup. Keep the per-identity rule of ADR 0004: a fallback profile must still never be shared across identities.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
