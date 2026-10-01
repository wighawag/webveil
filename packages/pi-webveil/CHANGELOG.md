# pi-webveil

## 0.9.1

### Patch Changes

- 9ac7d20: `webveil install-recipes ipfs://<cid>` on a directory that cannot be a recipe set (for example a release folder's root) now suggests `webveil install-recipes` commands, one per entry worth trying, carrying your route (`--egress`, `--direct`, or `--proxy <url>` as a placeholder, never your proxy URL or its credentials), your `--ipfs-gateway`, `--name` and `--force`, and `--sha256` on the archive suggestion only. It no longer passes on searchcast's `searchcast install-recipes` suggestion, which would have run the download outside webveil's egress. The refusal is otherwise unchanged (exit 1, nothing installed). Depends on searchcast `^0.4.2`, whose IPFS installer first asks a gateway for the directory's listing only (one small request) before fetching a set directory's files.
- Updated dependencies [9ac7d20]
  - webveil@0.14.1

## 0.9.0

### Minor Changes

- 7b10e10: `webveil install-recipes ipfs://<cid>[/<path>]` installs a recipe set from IPFS (a release archive, or a set directory with a `manifest.json`), through searchcast 0.4's installer: every block is fetched from a trustless gateway and verified against the CID, which is the pin, so `--sha256` is optional there (checked when given for an archive). The download follows the same route rule as a URL: through your egress with `--egress` (anonymously when it is Tor), `--proxy <url>` or `--direct`, and refused without one under a proxy egress. Gateways come from `--ipfs-gateway <url>` (repeatable), else the new `searchcast.ipfsGateways` setting (any config layer, or env `WEBVEIL_SEARCHCAST_IPFS_GATEWAYS`, comma-separated; not part of the search identity), else searchcast's defaults. `webveil recipes` shows an IPFS set's `ipfs://` source, CID and gateway (and its `sha256` only when it has one), and `webveil doctor` shows each installed `set:` entry's source. A URL or file without `--sha256` is now refused with `SHA256_REQUIRED` (exit 2) instead of a validation error (exit 1).

### Patch Changes

- Updated dependencies [7b10e10]
  - webveil@0.14.0

## 0.8.0

### Minor Changes

- cd07fa1: A browser engine is now named `browser:<recipe>` in `searchcast.engines` (it was `searchcast:<recipe>`, which no longer said "browser" once the backend itself is called searchcast). `searchcast:<recipe>` still works for one release, in `engines` and in `decoyGuard` (and `WEBVEIL_SEARCHCAST_DECOY_GUARD`), with one warning per config file (or for env) naming each old name: on stderr for the CLI and MCP server, in pi-webveil's notifications and tool result, and under `deprecations` in `webveil doctor`. Both prefixes naming the same recipe in one list is an error naming both. A chain keeps its identity key (state partition and browser profile) whichever prefix it uses; only a browser engine's cooldown restarts. A recipe may no longer be named `browser:...` (as `searchcast:...` was already refused), since that name now means a browser engine.

### Patch Changes

- 83a22d2: Text cleanup with no behaviour change. Error messages, the pi extension's degradation warning (now `[warning] search degraded (unresponsive engines: a, b). ...`), source comments and the docs no longer use em dashes, and examples name no real search engine except Mwmbl and Marginalia: they use placeholders such as `engine-a`. A repo test (`scripts/text-rules.mjs`) now fails on either, outside `work/` and the changelogs.
- Updated dependencies [cd07fa1]
- Updated dependencies [83a22d2]
  - webveil@0.13.0

## 0.7.1

### Patch Changes

- db97820: `MARGINALIA_API_KEY` now helps: with it set, the bundled Marginalia recipe calls Marginalia's current API (`api2.marginalia-search.com`) with the key in an `API-Key` header, so the key never appears in a URL or an error message. Without a key it still uses the older URL-keyed API with the shared `public` key. The recipe is a refreshed copy of searchcast's `examples/recipes/marginalia.mjs` at commit `701584826ee5d50177c8df667329f27e949fd4aa`, and webveil now depends on `searchcast` `^0.3.0`, whose code recipes can add author headers to a `fetch` request. The README says what each key does: Mwmbl's goes in its query, Marginalia's selects its current API.
- Updated dependencies [db97820]
  - webveil@0.12.1

## 0.7.0

### Minor Changes

- e92154c: The default engine chain is now `["mwmbl", "marginalia"]`: Mwmbl's keyless public API first, then Marginalia, from two code recipes bundled in the webveil package (`recipes/mwmbl.mjs` and a refreshed `recipes/marginalia.mjs`, copies of searchcast's examples at commit `7b0dbde7daf7b50cf99f6b7846b75e34db18602f`). Marginalia's keyless API alone left a fresh install unable to search while it was down. Search works right after `npm install -g webveil` or `pi install npm:pi-webveil` again.

  - **Still only a default.** It is used only when you configure no `searchcast.engines`, `recipes` or `codeRecipes`; any of them replaces it entirely, as before. No trust rule changes: a project `webveil.json` still cannot add code recipes.
  - **More quota.** Set `MWMBL_API_KEY` (and `MARGINALIA_API_KEY`) for a personal key; without one, Mwmbl's quota is per IP address, shared by everyone on a Tor exit or VPN.
  - **The README says what recipes add**, near the top: a site's search as an engine, code recipes for JavaScript result flows and challenges, a chain that falls through, a real browser as the last fallback, and a recipe set in one pinned command (`webveil install-recipes <url> --sha256 <hex>`).
  - **`webveil doctor`** adds a `defaultChain` notice (not a problem) while the default chain is in use, pointing to recipes.
  - The default chain's state starts one fresh partition (its identity key hashes the new chain); `webveil state clear --all` removes the old one.

### Patch Changes

- Updated dependencies [e92154c]
  - webveil@0.12.0

## 0.6.0

### Minor Changes

- b0a39b5: The default backend is searchcast with a bundled Marginalia chain; set `backend: "searxng"` for the previous default. `npm install -g webveil` (or `pi install npm:pi-webveil`) is now the whole setup: search works with no service to run, no account and nothing else to install, still on `direct` egress.

  - **The default chain.** When you configure no `searchcast.engines`, `recipes` or `codeRecipes`, the chain is `["marginalia"]`, from a code recipe shipped in the webveil package (`recipes/marginalia.mjs`, a copy of searchcast's example). It queries the Marginalia Search API, which is meant for programs, with the shared `public` key, which is rate limited for everyone who uses it: for regular use ask Marginalia for a free personal key (non-commercial) and set `MARGINALIA_API_KEY`. Its results are provided under CC-BY-NC-SA 4.0. Any engines, recipes or code recipes you configure replace the default chain entirely.
  - **No trust rule changes.** The bundled recipe is trusted because it ships in the package; a project `webveil.json` still cannot add code recipes.
  - **`web_fetch` now defaults to the impersonated transport** (`fetchTransport` follows the backend). Where libcurl-impersonate is not available, search and fetch fail with the fix (`webveil install-libcurl`, or `"fetchTransport": "plain"` for fetch), never a silent fallback to Node's TLS fingerprint.
  - **Upgrading from the SearXNG default.** webveil does not probe for a local SearXNG. While the backend is the built-in default, a failed search and `webveil doctor` (a `defaultBackend` notice) say that the default changed and that `"backend": "searxng"` restores it; `baseUrl` still defaults to `http://127.0.0.1:8080`.
  - **`webveil state clear`** in a folder with no searchcast settings now clears the default chain's identity instead of refusing.

- f96377d: webveil speaks of searchcast: the `serpcast` backend is now `searchcast`, and so are its config section, `fetchTransport` value and environment variables (serpcast was renamed searchcast). Your 0.10 config keeps working for one release: every old spelling is accepted exactly like the new one, with one warning naming the new spelling, and is removed in the next minor.

  | old                                                    | new                            |
  | ------------------------------------------------------ | ------------------------------ |
  | `backend: "serpcast"`                                  | `backend: "searchcast"`        |
  | config section `serpcast.*`                            | `searchcast.*`                 |
  | `serpcast.searchcast.*` (the browser runner's options) | `searchcast.browser.*`         |
  | `fetchTransport: "serpcast"`                           | `fetchTransport: "searchcast"` |
  | `fetchSerpcast.*`                                      | `fetchSearchcast.*`            |
  | `WEBVEIL_SERPCAST_*`                                   | `WEBVEIL_SEARCHCAST_*`         |
  | `WEBVEIL_SERPCAST_SEARCHCAST_*`                        | `WEBVEIL_SEARCHCAST_BROWSER_*` |
  | `WEBVEIL_FETCH_SERPCAST_*`                             | `WEBVEIL_FETCH_SEARCHCAST_*`   |
  | `WEBVEIL_BACKEND=serpcast`                             | `WEBVEIL_BACKEND=searchcast`   |
  - **Warnings**: on stderr for the CLI and the MCP server, once per process; in pi-webveil, once per session as a pi notification and at the end of the tool result; in `webveil doctor`, as `deprecations` (doctor stays healthy).
  - **Both spellings of one setting in one place is an error** naming both (for example `serpcast.engines` and `searchcast.engines` in one file); across files and env the usual precedence applies.
  - **Trust is unchanged**: a project `webveil.json` cannot set `serpcast.codeRecipes`, `serpcast.libcurlPath` or `serpcast.searchcast.chrome` any more than their new names.
  - **No state reset**: a config's identity key (its state directory and browser profile) is the same in either spelling, and unchanged by the rename.
  - **Library API**: the exports follow the new name without aliases (`createSearchcastBackend`, `searchcastIdentityKey`, `searchcastProxy`, `clearSearchcastState`, `createSearchcastFetch`, the types `SearchcastConfig` (the section), `BrowserConfig` (was `SearchcastConfig`, the browser options), `FetchSearchcastConfig`, `SearchcastDeps` with the seams `createSearchcast` and `importBrowser`, `SearchcastFetchDeps`). New: `configDeprecations`, `reportDeprecations`, and an `onWarning` option on `search` and `fetch`.
  - **pi-webveil** surfaces the warnings (see above) instead of letting them reach pi's terminal.

### Patch Changes

- Updated dependencies [b0a39b5]
- Updated dependencies [69c6e66]
- Updated dependencies [f96377d]
  - webveil@0.11.0

## 0.5.6

### Patch Changes

- Updated dependencies [9c82bd4]
  - webveil@0.10.0

## 0.5.5

### Patch Changes

- Updated dependencies [1a7dc0a]
  - webveil@0.9.0

## 0.5.4

### Patch Changes

- Updated dependencies [feeb0b2]
  - webveil@0.8.0

## 0.5.3

### Patch Changes

- Updated dependencies [9843314]
- Updated dependencies [a983a32]
  - webveil@0.7.0

## 0.5.2

### Patch Changes

- Updated dependencies [baad983]
  - webveil@0.6.0

## 0.5.1

### Patch Changes

- Updated dependencies [27bf27b]
  - webveil@0.5.1

## 0.5.0

### Minor Changes

- cae4e1d: New `serpcast` backend: keyless web search with no SearXNG, where webveil's `egress` is the search egress.

  - **`backend: "serpcast"`** runs declarative recipes through the [serpcast](https://github.com/wighawag/serpcast) engine chain over libcurl-impersonate. Configure it in a `serpcast` section: `engines` (engine names, tried in order), `recipes` (recipe files or directories), `libcurlPath`, `sessionIdleMs`, `cooldownMs`; env `WEBVEIL_SERPCAST_LIBCURL_PATH`, `WEBVEIL_SERPCAST_SESSION_IDLE_MS`, `WEBVEIL_SERPCAST_COOLDOWN_MS`.
  - **Egress is the search egress.** The backend-hop `egress` becomes serpcast's proxy: `socks5://`, `socks://` and `socks5h://` all reach it as `socks5h://` (DNS at the proxy), `http` passes through, `direct` means no proxy. The loopback-`baseUrl` guard does not apply to this backend.
  - **Strict impersonation, always.** Without a working libcurl-impersonate the search fails with the fix in the message (`npx serpcast install-libcurl`, or set `serpcast.libcurlPath`). There is no setting to turn strict mode off.
  - **`serpcast.libcurlPath` is an executable setting**: refused from a project `webveil.json`, used from the global config or env.
  - **Failures surface.** Engines that failed before the answering one appear in `unresponsiveEngines`; when every engine fails, the search is an error listing each engine's failure, never an empty list.
  - **One serpcast instance per identity** (backend-hop egress plus the resolved `serpcast` section), kept across searches in the MCP server and pi extension so cooldowns and sessions carry over; `closeBackends()` releases it at process level (after a one-shot CLI command, when the MCP server's stdin ends or it is signalled, and on pi's `session_shutdown`).

- 1968497: `web_fetch` can use a real browser's TLS and HTTP/2 fingerprint: the new `fetchTransport` key (`plain` or `serpcast`, env `WEBVEIL_FETCH_TRANSPORT`).

  - **`serpcast`** sends `web_fetch` through serpcast's libcurl-impersonate transport (Chrome's fingerprint and page-load headers, GET only) instead of undici. It is the default when `backend` is `serpcast`; `plain` stays the default with every other backend. An explicit value always wins.
  - **Same egress and SSRF guard.** It uses the fetch-hop egress (`fetchEgress`, else `egress`), with SOCKS always as `socks5h`. webveil follows redirects itself (at most 20) and runs the SSRF guard on every hop.
  - **Strict, never a fallback.** Without libcurl-impersonate `web_fetch` fails with the fix (`npx serpcast install-libcurl` or `serpcast.libcurlPath`); it never falls back to `plain`. With the serpcast backend this means `web_fetch` now needs the library too, or `"fetchTransport": "plain"`.
  - **No cookies between fetches**: each fetch is a fresh session, and nothing is written to the serpcast state.
  - `serpcast.libcurlPath` keeps its trust rule for fetch (refused from a project `webveil.json`, including with `fetchEgress` set).

### Patch Changes

- Updated dependencies [3e3dcbb]
- Updated dependencies [3b8bd4c]
- Updated dependencies [f8c19de]
- Updated dependencies [57e27ce]
- Updated dependencies [cae4e1d]
- Updated dependencies [d117757]
- Updated dependencies [1968497]
  - webveil@0.5.0

## 0.4.0

### Minor Changes

- 353442c: Surface SearXNG engine degradation, from the live "confident garbage" incident (2026-09-16): every curated engine refused or poisoned the instance's direct egress IP, and the one still answering (bing) served HTTP 200 "decoy SERPs" of unrelated results that parse as real ones — so the response carried no degradation signal at all.

  The searxng backend now threads the JSON response's `unresponsive_engines` through to callers:

  - **Some engines down, others answered** — results are annotated with a new optional `unresponsiveEngines` field on every hit (partial results are still useful, so this does not fail); the CLI/MCP output hoists the flag to a top-level `unresponsiveEngines` field, and the pi extension renders a `[warning] search degraded …` line in the tool text the model reads. A degraded answer never masquerades as a clean one.
  - **Zero results + engines unresponsive** — treated as a full outage and fails loud (an error naming the engines) instead of returning a confident empty list; a genuine no-hit query on a healthy instance still returns `[]`.

  Honest limit, stated in the docs: webveil **cannot detect junk results** — a decoy SERP is indistinguishable from a real one at this layer. When the surviving engine serves decoys, the response looks clean while being garbage end to end; the fix is egress-level (SearXNG's `outgoing.proxies`), never in webveil.

  Docs: a new `docs/searxng-setup.md` troubleshooting section documents the "irrelevant-but-confident results" symptom signature (a flagged egress IP, not a SearXNG bug), per-engine isolation via `curl --unix-socket … "&engines=<name>&format=json"`, and the `outgoing.proxies` fix; the README's "Where does anonymity live?" gains a chained-egress subsection (app → Mullvad WireGuard base → rotating-residential exit → site — `fetchEgress` points at the chain port like any `socks5h://` URL, the local SearXNG hop stays `direct`, and Tor cannot be a chain base since its exit path is fixed to Tor relays).

### Patch Changes

- 729a346: Add brand assets: a mark, a wordmark lockup and a 1280x640 social card, wired into both package READMEs as a header image.

  The mark draws the differentiator rather than symbolising it: a request enters a broken ring at one point and leaves it displaced, so the two ends cannot be linked and the ring is open exactly where it crosses. Sources, the build script and the reasoning live in `media/`.

- Updated dependencies [729a346]
- Updated dependencies [353442c]
  - webveil@0.4.0

## 0.3.0

### Minor Changes

- 9471004: Per-hop egress: a new optional `fetchEgress` (env `WEBVEIL_FETCH_EGRESS` /
  `WEBVEIL_FETCH_EGRESS_URL`) controls the `web_fetch` hop independently of the backend
  hop's `egress`. This makes the most common self-hosted topology expressible and blessed:
  a LOCAL SearXNG backend on a `direct` backend hop (its own `outgoing.proxies` anonymizes
  the engine crawl) while `web_fetch` of arbitrary URLs exits through a SOCKS5 proxy (e.g.
  wireproxy -> ProtonVPN at `socks5h://127.0.0.1:1080`).

  `fetchEgress` defaults to inheriting `egress` when unset, so existing single-`egress`
  configs are unchanged. The fail-loud false-confidence guard still rejects a NON-direct
  `egress` on a LOCAL backend `baseUrl` (now covering loopback TCP as well as `unix:`
  sockets), but it is scoped to the backend hop and does NOT block a proxied `web_fetch`.
  See docs/adr/0003.

### Patch Changes

- Updated dependencies [9471004]
  - webveil@0.3.0

## 0.2.2

### Patch Changes

- a26fb96: Fix dead documentation links on npmjs.com and expand egress/SearXNG docs.

  The publish-time asset copy (`scripts/copy-publish-assets.mjs`) now rewrites the
  published README's repo-relative links to files that are NOT in the tarball
  (`work/`, `docs/`, `packages/`, `CONTEXT.md`, `COPYRIGHT`) into absolute GitHub
  URLs, pinned to the per-package release tag (`name@version`, the tag Changesets
  pushes), so they point at the exact published tree instead of a moving `main`.
  The source README keeps repo-relative links (correct on GitHub); shipped assets
  (`README.md`, `LICENSE`) stay relative.

  README also gains a "ProtonVPN (via wireproxy)" and "Other SOCKS5 providers"
  section under Anonymous egress, the Quick start is trimmed to the minimal happy
  path, and the detailed SearXNG install matter (uwsgi vs `http-socket`, Unix
  sockets, reverse proxy, limiter) moves into `docs/searxng-setup.md`. The egress
  docs now make explicit that `socks5` is for a remote backend or `web_fetch`, and
  that a local SearXNG must instead carry the proxy on its own `outgoing.proxies`
  (webveil stays `direct`), matching the fail-loud guard.

- Updated dependencies [a26fb96]
  - webveil@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [38f1c42]
  - webveil@0.2.1

## 0.2.0

### Minor Changes

- 16f35b5: Config files moved to frontend-neutral locations (no more `.pi/`). The per-folder
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

### Patch Changes

- Updated dependencies [16f35b5]
  - webveil@0.2.0

## 0.1.2

### Patch Changes

- 37aec79: Fix a TUI crash (`TypeError: child.render is not a function`) when displaying `web_search` / `web_fetch` results. The tools defined `renderResult` to return a `string[]`, but pi's extension API expects a `Component`. The bad value was added as a render child and crashed pi's render pass, taking down the whole TUI. The custom `renderResult` is removed; pi now uses its built-in text renderer on the tool result's text content, which is the same compact output these tools already produce.

## 0.1.1

### Patch Changes

- Updated dependencies [db41195]
  - webveil@0.1.1

## 0.1.0

### Minor Changes

- 0321286: Initial release.

  **webveil** — anonymous-capable, self-hosted, account-free web search + fetch for agents:
  a framework-agnostic core (`search()` / `fetch()`) wrapped by an incur-based CLI + MCP
  server. Swappable backend seam (`searxng` | `tavily-compat` | `custom`), egress seam
  (`direct` | `http` | `socks5`/Tor) injected so a backend cannot bypass it (fail-loud on an
  unbuildable proxy), per-folder config, and a distilly-based Extractor seam that injects
  webveil's egress-controlled `fetch` into `distilly/fetch` (the network never escapes your
  egress; see `docs/adr/0001`). SSRF guard inside the egress fetch.

  **pi-webveil** — a pi extension registering exactly `web_search` and `web_fetch`, calling
  the webveil core in-process: a drop-in replacement for `@ollama/pi-web-search` with no
  account and no API key.

  Pins `@modelcontextprotocol/server` to `2.0.0-alpha.2` (its `alpha.3` moved
  `StdioServerTransport` to a `./stdio` subpath, which incur@0.4.10 does not yet import from,
  breaking `webveil --mcp`).

### Patch Changes

- Updated dependencies [0321286]
  - webveil@0.1.0
