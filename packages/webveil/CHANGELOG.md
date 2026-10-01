# webveil

## 0.14.0

### Minor Changes

- 7b10e10: `webveil install-recipes ipfs://<cid>[/<path>]` installs a recipe set from IPFS (a release archive, or a set directory with a `manifest.json`), through searchcast 0.4's installer: every block is fetched from a trustless gateway and verified against the CID, which is the pin, so `--sha256` is optional there (checked when given for an archive). The download follows the same route rule as a URL: through your egress with `--egress` (anonymously when it is Tor), `--proxy <url>` or `--direct`, and refused without one under a proxy egress. Gateways come from `--ipfs-gateway <url>` (repeatable), else the new `searchcast.ipfsGateways` setting (any config layer, or env `WEBVEIL_SEARCHCAST_IPFS_GATEWAYS`, comma-separated; not part of the search identity), else searchcast's defaults. `webveil recipes` shows an IPFS set's `ipfs://` source, CID and gateway (and its `sha256` only when it has one), and `webveil doctor` shows each installed `set:` entry's source. A URL or file without `--sha256` is now refused with `SHA256_REQUIRED` (exit 2) instead of a validation error (exit 1).

## 0.13.0

### Minor Changes

- cd07fa1: A browser engine is now named `browser:<recipe>` in `searchcast.engines` (it was `searchcast:<recipe>`, which no longer said "browser" once the backend itself is called searchcast). `searchcast:<recipe>` still works for one release, in `engines` and in `decoyGuard` (and `WEBVEIL_SEARCHCAST_DECOY_GUARD`), with one warning per config file (or for env) naming each old name: on stderr for the CLI and MCP server, in pi-webveil's notifications and tool result, and under `deprecations` in `webveil doctor`. Both prefixes naming the same recipe in one list is an error naming both. A chain keeps its identity key (state partition and browser profile) whichever prefix it uses; only a browser engine's cooldown restarts. A recipe may no longer be named `browser:...` (as `searchcast:...` was already refused), since that name now means a browser engine.

### Patch Changes

- 83a22d2: Text cleanup with no behaviour change. Error messages, the pi extension's degradation warning (now `[warning] search degraded (unresponsive engines: a, b). ...`), source comments and the docs no longer use em dashes, and examples name no real search engine except Mwmbl and Marginalia: they use placeholders such as `engine-a`. A repo test (`scripts/text-rules.mjs`) now fails on either, outside `work/` and the changelogs.

## 0.12.1

### Patch Changes

- db97820: `MARGINALIA_API_KEY` now helps: with it set, the bundled Marginalia recipe calls Marginalia's current API (`api2.marginalia-search.com`) with the key in an `API-Key` header, so the key never appears in a URL or an error message. Without a key it still uses the older URL-keyed API with the shared `public` key. The recipe is a refreshed copy of searchcast's `examples/recipes/marginalia.mjs` at commit `701584826ee5d50177c8df667329f27e949fd4aa`, and webveil now depends on `searchcast` `^0.3.0`, whose code recipes can add author headers to a `fetch` request. The README says what each key does: Mwmbl's goes in its query, Marginalia's selects its current API.

## 0.12.0

### Minor Changes

- e92154c: The default engine chain is now `["mwmbl", "marginalia"]`: Mwmbl's keyless public API first, then Marginalia, from two code recipes bundled in the webveil package (`recipes/mwmbl.mjs` and a refreshed `recipes/marginalia.mjs`, copies of searchcast's examples at commit `7b0dbde7daf7b50cf99f6b7846b75e34db18602f`). Marginalia's keyless API alone left a fresh install unable to search while it was down. Search works right after `npm install -g webveil` or `pi install npm:pi-webveil` again.

  - **Still only a default.** It is used only when you configure no `searchcast.engines`, `recipes` or `codeRecipes`; any of them replaces it entirely, as before. No trust rule changes: a project `webveil.json` still cannot add code recipes.
  - **More quota.** Set `MWMBL_API_KEY` (and `MARGINALIA_API_KEY`) for a personal key; without one, Mwmbl's quota is per IP address, shared by everyone on a Tor exit or VPN.
  - **The README says what recipes add**, near the top: a site's search as an engine, code recipes for JavaScript result flows and challenges, a chain that falls through, a real browser as the last fallback, and a recipe set in one pinned command (`webveil install-recipes <url> --sha256 <hex>`).
  - **`webveil doctor`** adds a `defaultChain` notice (not a problem) while the default chain is in use, pointing to recipes.
  - The default chain's state starts one fresh partition (its identity key hashes the new chain); `webveil state clear --all` removes the old one.

## 0.11.0

### Minor Changes

- b0a39b5: The default backend is searchcast with a bundled Marginalia chain; set `backend: "searxng"` for the previous default. `npm install -g webveil` (or `pi install npm:pi-webveil`) is now the whole setup: search works with no service to run, no account and nothing else to install, still on `direct` egress.

  - **The default chain.** When you configure no `searchcast.engines`, `recipes` or `codeRecipes`, the chain is `["marginalia"]`, from a code recipe shipped in the webveil package (`recipes/marginalia.mjs`, a copy of searchcast's example). It queries the Marginalia Search API, which is meant for programs, with the shared `public` key, which is rate limited for everyone who uses it: for regular use ask Marginalia for a free personal key (non-commercial) and set `MARGINALIA_API_KEY`. Its results are provided under CC-BY-NC-SA 4.0. Any engines, recipes or code recipes you configure replace the default chain entirely.
  - **No trust rule changes.** The bundled recipe is trusted because it ships in the package; a project `webveil.json` still cannot add code recipes.
  - **`web_fetch` now defaults to the impersonated transport** (`fetchTransport` follows the backend). Where libcurl-impersonate is not available, search and fetch fail with the fix (`webveil install-libcurl`, or `"fetchTransport": "plain"` for fetch), never a silent fallback to Node's TLS fingerprint.
  - **Upgrading from the SearXNG default.** webveil does not probe for a local SearXNG. While the backend is the built-in default, a failed search and `webveil doctor` (a `defaultBackend` notice) say that the default changed and that `"backend": "searxng"` restores it; `baseUrl` still defaults to `http://127.0.0.1:8080`.
  - **`webveil state clear`** in a folder with no searchcast settings now clears the default chain's identity instead of refusing.

- 69c6e66: webveil now depends on `searchcast` 0.2 and `@searchcast/recipe` 0.1 instead of `serpcast` and `serpcast-recipe` (serpcast was renamed searchcast: searchcast's ADR 0005). Behaviour is unchanged, and the `serpcast` backend name, config section and `WEBVEIL_SERPCAST_*` variables stay as they are for now.

  - **The native library comes with webveil.** On Linux x64 and arm64, macOS x64 and arm64 and Windows x64, searchcast brings the pinned libcurl-impersonate as its optional dependency `@searchcast/libcurl-<platform>`, so `webveil install-libcurl` is only needed where optional dependencies were skipped or the platform has no package. `webveil doctor` shows where the library was found (usually `platform package`).
  - **The browser fallback's optional peer is now `@searchcast/browser`** (`>=0.1.0 <0.2.0`), the browser runner formerly published as `searchcast` 0.1.x. If you installed `searchcast` next to webveil for library-mode browser engines, install `@searchcast/browser` instead; the error for a missing browser runner names it.
  - **New data directory.** `install-libcurl` and `install-recipes` write to `~/.local/share/searchcast` (`$XDG_DATA_HOME/searchcast`). A library or recipe set serpcast installed in `~/.local/share/serpcast` is still found for one release when the new directory has none (`set:<name>` keeps working); nothing is moved or written there. `webveil doctor` lists what is still read from the old directory (`oldDataDir`) with the command that moves it, and `webveil recipes` lists those sets as `oldSets`.
  - **State may reset once.** Identity keys of an unchanged config stay the same, except where a `set:` entry now resolves to the new data directory (after you move or reinstall the set): that identity then starts a fresh state partition once (new engine sessions and cooldowns; state is short-lived anyway).

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

## 0.10.0

### Minor Changes

- 9c82bd4: `install-libcurl` and `install-recipes` take `--egress`: download through the egress webveil already has configured (resolved as for `search`, SOCKS as `socks5h://`), with its credentials used but never printed. It takes `egress`, or `fetchEgress` when only that hop is a proxy; with every hop direct it is a direct download. An egress the downloader cannot use fails before any request. `--egress`, `--proxy` and `--direct` are mutually exclusive (exit 2), and the refusal under a proxy egress now offers `--egress` first.

## 0.9.0

### Minor Changes

- 1a7dc0a: `webveil install-libcurl` and `webveil install-recipes` no longer guess a download's route when the configured egress is a proxy. With `egress` or `fetchEgress` set to `http` or `socks5` (any config layer or env), they refuse with exit 2 before any request until you pass `--proxy <url>` or the new `--direct` flag, since a direct download would tell the host that your own IP installed it. The error names the configured egress (credentials as `***`) and shows the matching `--proxy` value (SOCKS as `socks5h://`). With a direct egress nothing changes. `--proxy` with `--direct` is a usage error; `install-recipes` of a local file needs neither.

## 0.8.0

### Minor Changes

- feeb0b2: webveil is now the only thing to install. Require `serpcast` `^0.6.0`. New CLI-only setup commands (not MCP or pi tools), wrapping serpcast's `serpcast/install` entry, which only they load: `webveil install-libcurl [--proxy <url>] [--force]`, `webveil install-recipes <url|path> --sha256 <hex> [--name <set>] [--proxy <url>] [--force]`, `webveil recipes` (the installed sets) and `webveil doctor [--remote]` (the library webveil loads plus this folder's backend, redacted egress, fetch transport, engines with their recipe files and configured sets; exit 1 with the problems when unhealthy). Downloads are direct unless `--proxy` is given, never through the configured egress. Every tuning value is now a config key with an env form, validated and defaulting to the old behaviour: `maxResults`, `httpTimeoutMs`, `fetchMaxRedirects` (both `web_fetch` transports, also under a proxy egress when set), the `fetchSerpcast` section (`maxIdleSessions`, `sessionIdleMs`, `reuseConnections`, `timeoutMs`, `maxBodyBytes`), and under `serpcast`: `timeoutMs`, `maxBodyBytes`, `reuseConnections`, `keepSessions`, `idlePollMs`, `maxRequestBodyBytes`, `preflightCache`, `maxPreflightAgeS`, `maxRedirects`, `decoyRule`, `decoyGuard` as `{include, exclude}` (now replaced whole across layers), `searchcast.timeoutMs`/`maxBodyBytes` (endpoint mode) and `state.persist`/`lockStaleMs`/`lockWaitMs`. `serpcast.sessionIdleMs` must now be positive (serpcast 0.6 refuses 0). Fix messages now name `webveil install-libcurl` and `webveil install-recipes`. The README gains an Install summary, a configuration reference table and uses the webveil commands in the NixOS section.

## 0.7.0

### Minor Changes

- 9843314: Require `serpcast` `^0.3.0` (`sec-fetch-site`, `referer`, `origin` and `sec-fetch-storage-access` now follow Chromium for same-site and cross-site subresources). `web_fetch` over the serpcast transport now reuses connections across fetches of the same fetch-hop egress (about 0.09 s instead of about 0.5 s per fetch over Tor): a small pool of sessions per egress, each fetch taking an idle one with its cookies cleared, never sharing a busy one, so no cookie is carried from one fetch to another. Idle sessions close after 10 minutes, or when webveil exits. A site sees repeated fetches to it on one TLS connection (see the README fetch section).
- a983a32: Require `serpcast` `^0.5.0` (and `serpcast-recipe` `^0.2.0`). Recipes may now declare `decoyProne: true` and are then checked for decoys without being listed in `serpcast.decoyGuard`; code recipes can POST (`ctx.http.post`, `ctx.http.postJson`) and set cookies (`ctx.cookies`). A recipe set installed with `npx serpcast install-recipes <archive> --sha256 <hex>` is named `set:<name>` (the whole set) or `set:<name>/<file>` in `serpcast.recipes` and `serpcast.codeRecipes` (and in `WEBVEIL_SERPCAST_CODE_RECIPES`), looked up in `$XDG_DATA_HOME/serpcast/recipes/`, never the cwd; `codeRecipes` stays refused from a project `webveil.json` whatever its form. A set directory's `manifest.json` and `.source.json` are no longer loaded as recipes. The README gains an "Installing recipes" section and a complete NixOS section (recipes, home-manager config, a full Tor example).

## 0.6.0

### Minor Changes

- baad983: Require `serpcast` `^0.2.0` and add the `serpcast.decoyGuard` config key (env `WEBVEIL_SERPCAST_DECOY_GUARD`, comma-separated): the engines it names (Bing, typically) have their answers checked for decoys, pages of results unrelated to the query, which then count as a `decoy` failure and hand over to the next engine, with no cooldown. serpcast 0.2 also reuses connections within an engine's session (per identity, never across), so repeated searches on the same engine are faster; `web_fetch` over the serpcast transport now closes its per-fetch session when the fetch settles.

## 0.5.1

### Patch Changes

- 27bf27b: Require `serpcast` `^0.1.1`. serpcast 0.1.0's transport deadlocked `process.exit()` while a request was in flight, so a failed or timed-out serpcast search in the webveil CLI hung forever instead of exiting; 0.1.1 fixes it, and the CLI now exits right after the timeout. The README also gains an "On NixOS" section and a note on Marginalia's shared API key.

## 0.5.0

### Minor Changes

- 3e3dcbb: Config trust layers: a cloned repository can no longer make webveil run code.

  - **Executable settings are refused from a project `webveil.json`.** The `custom` backend's command (its `baseUrl` when `backend` is `custom`) is accepted only from env or the global config; from a project file, `search` fails with a `TrustError` naming the file and the key. A project may still set `"backend": "custom"` when the command comes from a trusted layer, and `web_fetch` keeps working in such a folder (the check runs where the command is used). **Breaking for anyone who kept a `custom` command in a project `webveil.json`: move it to `~/.config/webveil/config.json` or `WEBVEIL_BASE_URL`.**
  - **Command paths never resolve against the cwd.** `~/` expands to the home directory, a relative path resolves against the directory of the config file that set it, a relative path from env is refused, and a bare command name (no slash) keeps its `PATH` lookup.
  - **Config sections merge key by key** across layers, so a project config that sets one key of a section keeps the global config's other keys; scalars and arrays are still replaced whole, and `egress`/`fetchEgress` are replaced whole as before. Every existing config resolves to the same values.
  - **Per-key provenance**: `configProvenance(config)` reports, for each resolved leaf key path, whether it came from env, a project file (with its path), the global file (with its path) or the defaults. `assertTrusted` and `resolveExecutablePath` are exported for backends that add executable settings.

- 3b8bd4c: serpcast state persists between CLI calls, partitioned per identity.

  - **On disk, per identity.** Sessions (engine cookies, code recipe state) and engine cooldowns live in `$XDG_STATE_HOME/webveil/<identity hash>/state.json` (default `~/.local/state/webveil/`), one directory per identity (backend-hop egress plus the resolved `serpcast` section, hashed with the same key as the cached instance). A session obtained on one egress is never read on another, and no URL or credential appears in a path.
  - **Expiry on read.** An entry past its expiry (a session idle longer than `serpcast.sessionIdleMs`, an ended cooldown) is never returned and is removed from the file.
  - **Safe under concurrency.** Each update runs under a lock file in the partition and replaces the file atomically (write, then rename); files are `0600`, directories `0700`.
  - **`webveil state clear [--all]`** removes the current folder's identity partition, or every partition.
  - New exports: `createStateStore`, `stateRoot`, `partitionDir`, `clearState`, `clearSerpcastState`.

- cae4e1d: New `serpcast` backend: keyless web search with no SearXNG, where webveil's `egress` is the search egress.

  - **`backend: "serpcast"`** runs declarative recipes through the [serpcast](https://github.com/wighawag/serpcast) engine chain over libcurl-impersonate. Configure it in a `serpcast` section: `engines` (engine names, tried in order), `recipes` (recipe files or directories), `libcurlPath`, `sessionIdleMs`, `cooldownMs`; env `WEBVEIL_SERPCAST_LIBCURL_PATH`, `WEBVEIL_SERPCAST_SESSION_IDLE_MS`, `WEBVEIL_SERPCAST_COOLDOWN_MS`.
  - **Egress is the search egress.** The backend-hop `egress` becomes serpcast's proxy: `socks5://`, `socks://` and `socks5h://` all reach it as `socks5h://` (DNS at the proxy), `http` passes through, `direct` means no proxy. The loopback-`baseUrl` guard does not apply to this backend.
  - **Strict impersonation, always.** Without a working libcurl-impersonate the search fails with the fix in the message (`npx serpcast install-libcurl`, or set `serpcast.libcurlPath`). There is no setting to turn strict mode off.
  - **`serpcast.libcurlPath` is an executable setting**: refused from a project `webveil.json`, used from the global config or env.
  - **Failures surface.** Engines that failed before the answering one appear in `unresponsiveEngines`; when every engine fails, the search is an error listing each engine's failure, never an empty list.
  - **One serpcast instance per identity** (backend-hop egress plus the resolved `serpcast` section), kept across searches in the MCP server and pi extension so cooldowns and sessions carry over; `closeBackends()` releases it at process level (after a one-shot CLI command, when the MCP server's stdin ends or it is signalled, and on pi's `session_shutdown`).

- d117757: serpcast code recipes: private engines (challenge handling, sites with restrictive terms) plug in as JS module files.

  - **`serpcast.codeRecipes`** lists code recipe modules or directories (every `*.js` and `*.mjs` inside), loaded with serpcast's `loadCodeRecipe` and usable in `serpcast.engines` like declarative recipes. Env form: `WEBVEIL_SERPCAST_CODE_RECIPES`, absolute or `~/` paths separated by the platform path delimiter (`:`, or `;` on Windows).
  - **An executable setting**: loading a code recipe runs it, so `serpcast.codeRecipes` is refused from a project `webveil.json` (with the file and key named) before any module is imported, and accepted from the global config or env. A project config that sets only `serpcast.engines` keeps the global `codeRecipes` and can list those recipes in its engine order.
  - Code and declarative recipes share one name space: a name used twice is an error.

- 1968497: `web_fetch` can use a real browser's TLS and HTTP/2 fingerprint: the new `fetchTransport` key (`plain` or `serpcast`, env `WEBVEIL_FETCH_TRANSPORT`).

  - **`serpcast`** sends `web_fetch` through serpcast's libcurl-impersonate transport (Chrome's fingerprint and page-load headers, GET only) instead of undici. It is the default when `backend` is `serpcast`; `plain` stays the default with every other backend. An explicit value always wins.
  - **Same egress and SSRF guard.** It uses the fetch-hop egress (`fetchEgress`, else `egress`), with SOCKS always as `socks5h`. webveil follows redirects itself (at most 20) and runs the SSRF guard on every hop.
  - **Strict, never a fallback.** Without libcurl-impersonate `web_fetch` fails with the fix (`npx serpcast install-libcurl` or `serpcast.libcurlPath`); it never falls back to `plain`. With the serpcast backend this means `web_fetch` now needs the library too, or `"fetchTransport": "plain"`.
  - **No cookies between fetches**: each fetch is a fresh session, and nothing is written to the serpcast state.
  - `serpcast.libcurlPath` keeps its trust rule for fetch (refused from a project `webveil.json`, including with `fetchEgress` set).

### Patch Changes

- f8c19de: Security fix: `web_fetch` now runs the SSRF guard on every redirect hop, not only the first url. On `direct` egress (the default) a public page that redirected to a private address (`127.0.0.1`, cloud metadata at `169.254.169.254`, or a hostname resolving to one) was fetched and returned; webveil now follows redirects itself (at most 20, http(s) only) and refuses such a target before it is requested. Legitimate redirect chains and their `web_fetch` output are unchanged, and `http`/`socks5` egress behaves as before (no local DNS).
- 57e27ce: Declare `searchcast` (`>=0.1.1`) as an optional peer dependency. It is still not installed with webveil: install it next to webveil for library-mode browser engines. Declaring it lets a strict pnpm layout expose it to webveil.

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

## 0.2.1

### Patch Changes

- 38f1c42: Fix the `webveil` CLI silently producing no output when run via its
  npm-installed bin (`npx webveil ...` or a `node_modules/.bin/webveil` entry).
  The `isMain()` entry-point guard compared `argv[1]` (the `.bin/webveil` symlink
  npm creates) against `import.meta.url` (the real `dist/cli.js`) without
  resolving symlinks, so the comparison was always false for an installed bin and
  the CLI never served (exit 0, empty output). Both sides are now resolved with
  `realpathSync` before comparing. Added a regression test that launches the built
  bin through a symlink and asserts it serves.

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

## 0.1.1

### Patch Changes

- db41195: Fix a brittle isolation test and correct the SearXNG Unix-socket docs.

  - **Test fix:** the `unix:` baseUrl isolation test no longer asserts that a real install
    path (`/usr/local/searxng/run/socket`) is absent — that assertion fails on any machine
    where SearXNG is actually installed (webveil's target users). Isolation is now proven over
    the test's own temp fixture only (`readdirSync(dir)` holds exactly the test socket).
  - **Docs:** the README "Other SearXNG install options" section and the
    `searxng-install-topology` finding now state that the install-script default socket speaks
    the **uwsgi protocol, not HTTP**, so a `unix:` baseUrl needs the socket switched to
    `http-socket =` (or a reverse proxy) first; they also document the required limiter +
    JSON-format `settings.yml` changes (the `429` fix) and how a Caddy/nginx browser frontend
    can coexist with `http-socket`. webveil stays HTTP-only by design (no uwsgi-protocol
    support).

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
