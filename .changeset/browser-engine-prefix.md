---
'webveil': minor
'pi-webveil': minor
---

A browser engine is now named `browser:<recipe>` in `searchcast.engines` (it was `searchcast:<recipe>`, which no longer said "browser" once the backend itself is called searchcast). `searchcast:<recipe>` still works for one release, in `engines` and in `decoyGuard` (and `WEBVEIL_SEARCHCAST_DECOY_GUARD`), with one warning per config file (or for env) naming each old name: on stderr for the CLI and MCP server, in pi-webveil's notifications and tool result, and under `deprecations` in `webveil doctor`. Both prefixes naming the same recipe in one list is an error naming both. A chain keeps its identity key (state partition and browser profile) whichever prefix it uses; only a browser engine's cooldown restarts. A recipe may no longer be named `browser:...` (as `searchcast:...` was already refused), since that name now means a browser engine.
