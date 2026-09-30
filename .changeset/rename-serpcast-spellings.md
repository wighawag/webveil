---
'webveil': minor
'pi-webveil': minor
---

webveil speaks of searchcast: the `serpcast` backend is now `searchcast`, and so are its config section, `fetchTransport` value and environment variables (serpcast was renamed searchcast). Your 0.10 config keeps working for one release: every old spelling is accepted exactly like the new one, with one warning naming the new spelling, and is removed in the next minor.

| old | new |
| --- | --- |
| `backend: "serpcast"` | `backend: "searchcast"` |
| config section `serpcast.*` | `searchcast.*` |
| `serpcast.searchcast.*` (the browser runner's options) | `searchcast.browser.*` |
| `fetchTransport: "serpcast"` | `fetchTransport: "searchcast"` |
| `fetchSerpcast.*` | `fetchSearchcast.*` |
| `WEBVEIL_SERPCAST_*` | `WEBVEIL_SEARCHCAST_*` |
| `WEBVEIL_SERPCAST_SEARCHCAST_*` | `WEBVEIL_SEARCHCAST_BROWSER_*` |
| `WEBVEIL_FETCH_SERPCAST_*` | `WEBVEIL_FETCH_SEARCHCAST_*` |
| `WEBVEIL_BACKEND=serpcast` | `WEBVEIL_BACKEND=searchcast` |

- **Warnings**: on stderr for the CLI and the MCP server, once per process; in pi-webveil, once per session as a pi notification and at the end of the tool result; in `webveil doctor`, as `deprecations` (doctor stays healthy).
- **Both spellings of one setting in one place is an error** naming both (for example `serpcast.engines` and `searchcast.engines` in one file); across files and env the usual precedence applies.
- **Trust is unchanged**: a project `webveil.json` cannot set `serpcast.codeRecipes`, `serpcast.libcurlPath` or `serpcast.searchcast.chrome` any more than their new names.
- **No state reset**: a config's identity key (its state directory and browser profile) is the same in either spelling, and unchanged by the rename.
- **Library API**: the exports follow the new name without aliases (`createSearchcastBackend`, `searchcastIdentityKey`, `searchcastProxy`, `clearSearchcastState`, `createSearchcastFetch`, the types `SearchcastConfig` (the section), `BrowserConfig` (was `SearchcastConfig`, the browser options), `FetchSearchcastConfig`, `SearchcastDeps` with the seams `createSearchcast` and `importBrowser`, `SearchcastFetchDeps`). New: `configDeprecations`, `reportDeprecations`, and an `onWarning` option on `search` and `fetch`.
- **pi-webveil** surfaces the warnings (see above) instead of letting them reach pi's terminal.
