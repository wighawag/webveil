---
'webveil': minor
---

serpcast state persists between CLI calls, partitioned per identity.

- **On disk, per identity.** Sessions (engine cookies, code recipe state) and engine cooldowns live in `$XDG_STATE_HOME/webveil/<identity hash>/state.json` (default `~/.local/state/webveil/`), one directory per identity (backend-hop egress plus the resolved `serpcast` section, hashed with the same key as the cached instance). A session obtained on one egress is never read on another, and no URL or credential appears in a path.
- **Expiry on read.** An entry past its expiry (a session idle longer than `serpcast.sessionIdleMs`, an ended cooldown) is never returned and is removed from the file.
- **Safe under concurrency.** Each update runs under a lock file in the partition and replaces the file atomically (write, then rename); files are `0600`, directories `0700`.
- **`webveil state clear [--all]`** removes the current folder's identity partition, or every partition.
- New exports: `createStateStore`, `stateRoot`, `partitionDir`, `clearState`, `clearSerpcastState`.
