---
title: a persistent searchcast profile is not safe across concurrent processes
slug: searchcast-persistent-profile-concurrent-processes
---

2026-09-29, from task `searchcast-fallback-and-guard`. With `serpcast.searchcast.persistProfile`, two webveil processes of the same identity (two CLI calls, or the CLI next to a long-lived MCP server) point two Chromium instances at one `<partition>/browser-profile`, which Chromium's own profile lock refuses; and the idle expiry (`packages/webveil/src/core/state.ts`, `isProfileIdle`/`deleteProfile`) does not take the partition's `state.lock`, so it could delete a profile another process's browser still uses after that process sat idle. The default (ephemeral profile) is unaffected.
