---
title: webveil state clear removes a persistent profile a live process still owns
slug: state-clear-ignores-profile-owner
---

2026-10-26, from task `profile-expiry-under-partition-lock`. `clearState` (`packages/webveil/src/core/state.ts`) removes the whole partition under the lock but does not look at `browser-profile.owner`, so `webveil state clear` next to a running MCP server with `persistProfile` deletes the profile (and the owner marker) under that server's live browser. It is an explicit user command, so maybe intended; worth a decision (refuse, warn, or document).
