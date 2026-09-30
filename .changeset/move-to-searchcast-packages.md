---
'webveil': minor
---

webveil now depends on `searchcast` 0.2 and `@searchcast/recipe` 0.1 instead of `serpcast` and `serpcast-recipe` (serpcast was renamed searchcast: searchcast's ADR 0005). Behaviour is unchanged, and the `serpcast` backend name, config section and `WEBVEIL_SERPCAST_*` variables stay as they are for now.

- **The native library comes with webveil.** On Linux x64 and arm64, macOS x64 and arm64 and Windows x64, searchcast brings the pinned libcurl-impersonate as its optional dependency `@searchcast/libcurl-<platform>`, so `webveil install-libcurl` is only needed where optional dependencies were skipped or the platform has no package. `webveil doctor` shows where the library was found (usually `platform package`).
- **The browser fallback's optional peer is now `@searchcast/browser`** (`>=0.1.0 <0.2.0`), the browser runner formerly published as `searchcast` 0.1.x. If you installed `searchcast` next to webveil for library-mode browser engines, install `@searchcast/browser` instead; the error for a missing browser runner names it.
- **New data directory.** `install-libcurl` and `install-recipes` write to `~/.local/share/searchcast` (`$XDG_DATA_HOME/searchcast`). A library or recipe set serpcast installed in `~/.local/share/serpcast` is still found for one release when the new directory has none (`set:<name>` keeps working); nothing is moved or written there. `webveil doctor` lists what is still read from the old directory (`oldDataDir`) with the command that moves it, and `webveil recipes` lists those sets as `oldSets`.
- **State may reset once.** Identity keys of an unchanged config stay the same, except where a `set:` entry now resolves to the new data directory (after you move or reinstall the set): that identity then starts a fresh state partition once (new engine sessions and cooldowns; state is short-lived anyway).
