# pi-webveil

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
