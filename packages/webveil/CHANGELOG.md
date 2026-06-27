# webveil

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
