---
title: serpcast.searchcast.chromeArgs can override the browser proxy
slug: searchcast-chrome-args-can-override-proxy
---

2026-09-29, from task `searchcast-fallback-and-guard`. `serpcast.searchcast.chromeArgs` (trusted layers only) is passed to Chromium as-is, so a `--proxy-server=...`, `--no-proxy-server` or `--proxy-bypass-list=...` there can silently take the browser off webveil's egress (which argument wins depends on Chromium's parsing). The user set it themselves, so it is not a trust hole, but it breaks the "egress never silently becomes direct" invariant (ADR 0001); a follow-up could refuse proxy-related flags in `packages/webveil/src/core/backends/serpcast.ts` (`browserSettings`).
