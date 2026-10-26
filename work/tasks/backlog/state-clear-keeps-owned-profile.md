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
