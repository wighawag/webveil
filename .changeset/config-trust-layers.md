---
'webveil': minor
---

Config trust layers: a cloned repository can no longer make webveil run code.

- **Executable settings are refused from a project `webveil.json`.** The `custom` backend's command (its `baseUrl` when `backend` is `custom`) is accepted only from env or the global config; from a project file, `search` fails with a `TrustError` naming the file and the key. A project may still set `"backend": "custom"` when the command comes from a trusted layer, and `web_fetch` keeps working in such a folder (the check runs where the command is used). **Breaking for anyone who kept a `custom` command in a project `webveil.json`: move it to `~/.config/webveil/config.json` or `WEBVEIL_BASE_URL`.**
- **Command paths never resolve against the cwd.** `~/` expands to the home directory, a relative path resolves against the directory of the config file that set it, a relative path from env is refused, and a bare command name (no slash) keeps its `PATH` lookup.
- **Config sections merge key by key** across layers, so a project config that sets one key of a section keeps the global config's other keys; scalars and arrays are still replaced whole, and `egress`/`fetchEgress` are replaced whole as before. Every existing config resolves to the same values.
- **Per-key provenance**: `configProvenance(config)` reports, for each resolved leaf key path, whether it came from env, a project file (with its path), the global file (with its path) or the defaults. `assertTrusted` and `resolveExecutablePath` are exported for backends that add executable settings.
