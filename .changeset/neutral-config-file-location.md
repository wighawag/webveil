---
'webveil': minor
'pi-webveil': minor
---

Config files moved to frontend-neutral locations (no more `.pi/`). The per-folder
project file is now `webveil.json` (walked up from cwd, first found wins), and the
global file is `$XDG_CONFIG_HOME/webveil/config.json` (default
`~/.config/webveil/config.json`).

Both frontends (the pi-agnostic CLI and the pi extension) now resolve the same
neutral `webveil.json`, so a project is configured identically regardless of which
frontend reads it. A pi-agnostic tool no longer requires a `.pi/` directory.

BREAKING (pre-1.0): the old `.pi/webveil.json` and `~/.pi/agent/webveil.json` paths
are no longer read. Move `.pi/webveil.json` to `webveil.json` at the same location,
and `~/.pi/agent/webveil.json` to `~/.config/webveil/config.json`. Env vars
(`WEBVEIL_*`) are unchanged. See `docs/adr/0002`.
