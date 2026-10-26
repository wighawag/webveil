---
title: webveil state clear keeps a browser profile another live process owns, unless --force
slug: state-clear-keeps-owned-profile
blockedBy: []
covers: []
---

## What to build

`webveil state clear` (and the `state_clear` MCP tool) removes a whole identity partition under its lock, including a persistent browser profile that another live webveil process owns (`browser-profile.owner`, see `claimProfile` in the state module), deleting files under a running Chromium. Change it so that, per partition, everything is removed except a profile (and its owner marker and use clock) owned by another live process; that partition is then reported as kept-in-part, with the owner's pid and how to remove it (stop that process, or pass `--force`). A profile owned by this process, by a dead pid, or by nobody is removed as before. `--force` (CLI option and MCP tool argument) removes everything regardless, as today. The ownership check and the removal happen under the partition lock, so they cannot race a claim. The command's output stays machine-readable: `cleared` as today, plus a `kept` list of `{identity, pid}`.

## Acceptance criteria

- [ ] With a live other-process owner, `state clear` removes the partition's sessions, cooldowns and code-recipe state but keeps the profile, its owner marker and use clock, and reports `{identity, pid}` under `kept` with the hint.
- [ ] With no owner, a dead owner, or this process as owner, the partition is removed entirely, as before.
- [ ] `--force` removes everything, owned or not, in the CLI and the MCP tool.
- [ ] `--all` applies the same rule to every partition.
- [ ] README's state section documents the behaviour.
- [ ] Tests isolate `XDG_STATE_HOME` in a temp dir and assert the real state dir is untouched; a live other-process owner is simulated with a real child process's pid.
- [ ] A changeset (minor: new option and output field).

## Blocked by

- None, can start immediately.

## Prompt

Origin: observation `state-clear-ignores-profile-owner` (delete it once resolved). Human decision (2026-10-26): keep the owned profile and say so, `--force` to override; neither refuse the whole command nor only document. Reuse the owner and liveness helpers in the state module; do not duplicate the liveness rule.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Decisions

These are recorded in the JSDoc on `clearState` in `state.ts` and in the comment above `state` in `cli.ts`.
1. **A kept partition is listed only under `kept`, not also under `cleared`.** `cleared` keeps meaning "the directory is gone". The alternative was listing it in both. This affects the CLI and MCP output.
2. **A kept partition leaves the lock's own entries alone** (`state.lock` and any `state.lock.*`), because removing a waiter's half-built lock would make its lock attempt fail.
3. **Breaking library change:** `clearState` and `clearSearchcastState` now return `{cleared, kept}` instead of a list of ids, and `clearState`'s third argument is now `{force, lock}` instead of the lock timing alone. The package is 0.x, so a minor bump allows this, and the changeset says so.
4. **The hint is a `hint` field in the output** (present only when something was kept), not an incur call-to-action or a stderr warning, so MCP clients and pipes see it too.
