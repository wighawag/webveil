---
title: Deep-merged config sections with per-key provenance; executable settings refused from a project webveil.json
slug: config-trust-layers
spec: serpcast-backend
blockedBy: []
covers: [13, 14]
---

## What to build

Two changes to config resolution, plus a trust check built on them.

1. **Deep merge of sections.** Plain-object config sections (such as the upcoming `serpcast` section) are merged key by key across layers instead of the higher layer replacing the whole object. Arrays and scalars are still replaced as a whole by the highest layer that sets them. `egress` and `fetchEgress` are exceptions: they are tagged unions keyed by `mode`, so each is a leaf, replaced whole (merging them would produce mixed objects such as `direct` with a stray url, or `http` with a SOCKS url). So a project `webveil.json` that sets one key of a section keeps the other keys from the global config.
2. **Provenance per key path.** Resolution records, for every resolved leaf key path (for example `baseUrl`, `serpcast.engines`), which layer it came from: env, project `webveil.json` (with its path), global config, or defaults.
3. **Trust check at use time.** A single helper takes the resolved config, its provenance and a list of executable key paths, and refuses any executable key whose value came from a project `webveil.json`, with an error that names the file and the key and says to move the setting to the global config or env. It runs where the setting is used (when a backend that needs it is constructed), not in resolution, so `web_fetch` and other backends keep working in a folder whose project config names an executable setting they do not use. Today's only executable key is the `custom` backend's command, which is its `baseUrl`: when the backend is `custom`, `baseUrl` is executable. Later tasks extend the list (serpcast's code recipes, libcurl path, searchcast browser paths and args).
4. **Path resolution for executable settings.** A trusted value must not be able to point into the cwd, which a hostile repository controls. So paths in executable settings (and the executable of the `custom` command) are resolved by one helper: a leading `~` expands to the home directory; other relative paths resolve against the directory of the config file that set them; values from env must be absolute (or `~`-prefixed) and are refused otherwise; nothing ever resolves against the cwd. A bare command name for `custom` (no slash) keeps today's PATH lookup.

The README's per-folder config section gains a short "what a project config can and cannot do" paragraph, and explains that sections merge key by key.

## Acceptance criteria

- [ ] A project layer setting one key of a section keeps the global layer's other keys in that section; arrays are replaced as a whole.
- [ ] Provenance is available for every resolved leaf key path; for project keys it includes the file path.
- [ ] `backend: custom` with the command in a project `webveil.json` is refused with the file and key named; the same command from global config or env works.
- [ ] A project `webveil.json` that sets `backend: custom` while the command comes from a trusted layer works.
- [ ] In a folder whose project config sets an executable key, `web_fetch` still works (the check only runs where the key is used).
- [ ] Existing configs resolve to the same values as before (existing config tests pass unchanged). `egress` and `fetchEgress` are replaced whole: global `{mode: socks5, url}` under project `{mode: direct}` resolves to exactly `{mode: direct}`, and global socks5 under project `{mode: http}` without a url still fails loud with the missing-url error.
- [ ] Executable paths: a global `~/x` resolves under the home directory; a relative path in the global config resolves against the global config's directory; a relative path from env is refused; none of them ever resolves inside the cwd (tested with a cwd containing a matching `~` or relative directory).
- [ ] README documents the merge rule and the trust rule.
- [ ] Tests cover the new behaviour; tests isolate the global config dir (`XDG_CONFIG_HOME`) in a temp dir and assert the real one is untouched.

## Blocked by

- None, can start immediately.

## Prompt

Goal: a cloned repository must never be able to make webveil run code (ADR 0004), and nested config must merge sensibly so a project config cannot silently drop the user's global settings. webveil resolves config by walking up from the cwd (ADR 0002), so a `webveil.json` in any checkout is read automatically; the `custom` backend spawns its `baseUrl` as a command, which today makes that a code-execution path. Today layers are merged with a shallow `Object.assign`; check whether any existing key relies on whole-object replacement (the egress objects in particular) and record what you find. Keep the trust helper in one place so the serpcast backend reuses it. Read `work/specs/tasked/serpcast-backend.md` for context.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
