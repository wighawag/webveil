# pi-webveil

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
