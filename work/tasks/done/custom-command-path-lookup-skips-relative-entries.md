---
title: Resolve a bare `custom` command over absolute PATH entries only, so a relative PATH entry cannot run a file from the cwd
slug: custom-command-path-lookup-skips-relative-entries
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

`config-trust-layers` made executable settings trusted-layer only and resolves any command path with a slash without ever consulting the cwd. A bare command name (no slash) for the `custom` backend still goes to `spawn`'s own PATH lookup, and `spawn` inherits the process cwd. So a PATH containing an empty entry, `.` or any relative directory resolves the command inside the cwd, which a cloned repository controls (observation `work/notes/observations/custom-bare-command-path-lookup-and-relative-path-entries.md`, which this task resolves and deletes). Resolve a bare name in webveil itself, in the trust module next to `resolveExecutablePath`: walk PATH, skip empty and non-absolute entries, take the first absolute entry holding an executable regular file of that name (on Windows honour PATHEXT), and spawn that absolute path. No match is a clear error naming the command and saying relative PATH entries are ignored.

## Acceptance criteria

- [ ] With PATH `.:<abs dir>` (and separately with an empty entry and a relative `bin`), and a decoy executable of the same name in the cwd, the absolute-dir executable runs and the decoy never does.
- [ ] With only relative PATH entries matching, the backend fails with a clear error before spawning anything.
- [ ] A bare name found in an absolute PATH entry keeps working as today; commands with a slash are unchanged.
- [ ] The helper lives in `core/trust.ts` (one place, reused by later executable settings) and is documented in the README's trust paragraph.
- [ ] The observation note is deleted; tests isolate `XDG_CONFIG_HOME` as the existing trust tests do.

## Blocked by

- None, can start immediately.

## Prompt

Goal: close the last cwd path in the `custom` command lookup (ADR 0004). Read `packages/webveil/src/core/trust.ts` and `core/backends/custom.ts` first. FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
