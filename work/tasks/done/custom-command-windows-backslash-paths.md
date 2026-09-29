---
title: Treat a Windows path with backslashes in the custom command as a path, not a bare command name
slug: custom-command-windows-backslash-paths
spec: serpcast-backend
blockedBy: [state-lock-stale-takeover-race]
covers: []
---

## What to build

`resolveExecutable` in `packages/webveil/src/core/backends/custom.ts` decides "bare command name" with `!command.includes('/')`. On Windows a path written only with backslashes (`C:\tools\search.exe`, `.\bin\search.cmd`, `bin\search.cmd`, `\\server\share\x.exe`) has no `/`, so it is looked up on PATH as a bare name (noted at Gate-3 of PR #14). Decide "has a path separator" per platform (on Windows `/` or `\` or a drive prefix like `C:`; elsewhere only `/`, since `\` is a legal file-name character on POSIX), and route those values through `resolveExecutablePath` (which must itself treat a Windows absolute path, including drive-letter and UNC forms, as absolute and resolve Windows-relative ones against the config file's directory, never the cwd). Use `node:path`'s `win32`/`posix` variants through a platform seam so it is testable on Linux. Apply the same rule wherever else a command or executable path is classified (for example the serpcast backend's executable paths), and record where.

## Acceptance criteria

- [ ] With platform `win32` (seam), `C:\x\y.exe`, `C:/x/y.exe`, `\\srv\share\y.exe` are absolute; `bin\y.cmd` and `.\y.cmd` resolve against the setting's config-file directory (and are refused from env as relative); `search` stays a bare PATH lookup.
- [ ] On POSIX, a name containing `\` but no `/` is unchanged from today (a bare name).
- [ ] Existing trust and custom-backend tests pass unchanged.

## Blocked by

- state-lock-stale-takeover-race (serialized: sequential drive)

## Prompt

FIRST, check this task against current reality. RECORD non-obvious decisions.
