---
title: Refuse Chromium arguments that would take the searchcast browser off webveil's egress
slug: refuse-proxy-overriding-chrome-args
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

`serpcast.searchcast.chromeArgs` (trusted layers only) is passed to Chromium as-is, so an argument such as `--proxy-server=...`, `--no-proxy-server`, `--proxy-bypass-list=...`, `--proxy-pac-url=...` or `--proxy-auto-detect` can silently move the library-mode browser off the configured egress, breaking the invariant that egress never silently becomes direct (ADR 0001, ADR 0004). Observation `work/notes/observations/searchcast-chrome-args-can-override-proxy.md` (resolves and deletes it). Refuse, where the settings are validated (`browserSettings` in `packages/webveil/src/core/backends/serpcast.ts`), any chrome argument whose name (before `=`, case-insensitive, with one or two leading dashes) is one of the proxy-controlling switches (at least `proxy-server`, `no-proxy-server`, `proxy-bypass-list`, `proxy-pac-url`, `proxy-auto-detect`, `winhttp-proxy-resolver`, `host-resolver-rules`, `host-rules`) with an error naming the argument and saying the proxy comes from `egress`. Recording which list was chosen and its source (Chromium's `switches.cc` / `net/proxy_resolution` switch names) is part of the task.

## Acceptance criteria

- [ ] Each listed switch, in `--x`, `--x=value`, `-x` and mixed-case forms, from global config or env, is refused with an error naming it, before searchcast is imported or any browser starts.
- [ ] Unrelated chrome args still pass through unchanged.
- [ ] The refusal applies whether or not a browser engine is listed (like the other executable-key checks).
- [ ] README's searchcast section says proxy-related chrome args are refused and why.
- [ ] The observation note is deleted; tests isolate the config and state dirs as the existing searchcast tests do.

## Blocked by

- None, can start immediately.

## Prompt

Goal: the browser's egress is only ever webveil's `egress`. Keep the change small and in one place. FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
