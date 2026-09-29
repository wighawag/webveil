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

## Decisions

These are recorded in the "Recorded decisions (task refuse-proxy-overriding-chrome-args)" comment block at the top of `serpcast.ts`:
1. **Error type:** it throws `EgressError`, not the plain settings error. It is an egress guard like `assertBrowserEgress`, so the error type is the user-visible choice here. The alternative was the plain `Error` used for badly formed settings.
2. **The list and its source:** Chromium's proxy switches (from `chrome_switches.cc`, read by `net/proxy_resolution`), plus the two host-mapping switches (from `network_switches.cc`), which can send a hostname to another address without using the proxy's DNS. It is a deny list rather than an allow list, because an allow list would refuse the many harmless arguments people need.
3. **Matching:** names are matched ignoring case, because Chromium lowercases switch names on Windows. An argument with no leading dash is a positional argument to Chromium, not a switch, so it passes.

The LOC table in the README was already out of date for `serpcast.ts` (it says 237; the built file is now 396 lines). I left it, because `docs-serpcast-backend` owns that table.
