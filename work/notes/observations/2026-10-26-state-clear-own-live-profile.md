---
title: the state_clear MCP tool removes the serving process's own live browser profile
slug: state-clear-own-live-profile
---

2026-10-26, from task `state-clear-keeps-owned-profile`. `clearState` (`packages/webveil/src/core/state.ts`) treats a profile owned by THIS process like an unowned one and removes the whole partition, per the task. Over `webveil --mcp` (or the pi extension) the clearing process is the one whose cached searchcast instance may have a running Chromium on that profile, so `state_clear` still deletes files under its own live browser and drops its owner marker without closing the instance (`closeSearchcastInstances` is not called). Worth a decision: close the own instance first, or keep the profile in that case too.
