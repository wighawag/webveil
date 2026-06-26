# webveil

**Anonymous-capable, self-hosted, account-free** web **search + fetch** for AI agents.

webveil replaces account-bound tools (notably Ollama's `web_search` / `web_fetch`, which
proxy a hosted service and sign every request with your account identity) with a
self-hosted path that has **no account, no API key**, and an **egress you control**
(direct, HTTP proxy, or SOCKS5/Tor) so searches and fetches can be anonymous. It also
works perfectly well non-anonymously (direct egress).

## Packages

webveil is a pnpm workspace monorepo. The **core** (`search()` / `fetch()`) is plain,
framework-agnostic. Two thin frontends wrap that same core:

- **[`webveil`](packages/webveil)** — an [incur](https://github.com/wevm/incur)-based
  **CLI + MCP server** (`--mcp`, skills, `--llms`, TOON output). Pi-agnostic; usable by any
  agent (pi via pi-mcp-adapter, Claude Code, Cursor, Codex, bash). Has a `webveil` bin.
- **[`pi-webveil`](packages/pi-webveil)** — a **pi extension** registering `web_search` and
  `web_fetch` tools that call the core in-process. A drop-in replacement for Ollama's tools
  (same names), which is the original motivation. Depends on `webveil` via `workspace:*`.

## How it works (seams)

- **core** — the framework-agnostic `search(query, opts)` and `fetch(url, opts)` functions.
  Both frontends call the same core.
- **backend seam** — where results/content come from: `searxng` (keyless self-hosted
  metasearch), `tavily-compat` (a generic Tavily-shaped `/search` + `/extract`), and
  `custom` (a local command via a JSON stdin/stdout contract). The backend is handed a
  proxied `http` helper so it cannot bypass egress.
- **egress seam** — how outbound HTTP leaves the machine: `direct`, `http` (undici
  `ProxyAgent`), or `socks5` (Tor `127.0.0.1:9050`, Mullvad `10.64.0.1:1080`). SOCKS5 is
  the mode that matters for anonymity. Fail-loud if a configured proxy cannot be built.
- **config seam** — per-folder resolution: env > nearest `.pi/webveil.json` walking up from
  cwd > global `~/.pi/agent/webveil.json` > defaults. Per folder = per account/egress.
- **extractor seam** — `urlToMarkdown` via `distilly/fetch` by default, injected with
  webveil's egress-bound `fetch`; a backend's own `/extract` (Tavily-compat) may override
  it. Owns the context-friendly markdown + size presets (`s`/`m`/`l`/`f`). See
  [`docs/adr/0001`](docs/adr/0001-extractor-uses-distilly-fetch-with-injected-egress.md).
- **security** — an SSRF guard lives in the egress fetch, so it covers distilly's
  rule-rewritten requests too.

## License

AGPL-3.0-or-later. webveil depends on `distilly` (MIT, the local HTML-to-markdown
extractor; webveil uses its networked `distilly/fetch` entrypoint with an injected egress
fetch) and `incur` (MIT). MIT code may be used by AGPL software; `distilly` stays
GPL/AGPL-free so it remains cleanly reusable under MIT. See [`LICENSE`](LICENSE) and
[`COPYRIGHT`](COPYRIGHT).

## Size discipline (per-module LOC)

Every module stays small with one responsibility. Per-module LOC is tracked here as a
first-class quality signal. `target` is the rough ceiling from `CONTEXT.md` (a ceiling, not
a promise); `LOC` is the actual line count of the built file.

### `packages/webveil` (core + CLI/MCP frontend)

| module                             |  LOC | target |
| ---------------------------------- | ---: | -----: |
| src/index.ts (barrel)              |   82 |      - |
| src/cli.ts (incur frontend)        |  106 |    ~80 |
| src/core/search.ts                 |  104 |    ~90 |
| src/core/fetch.ts                  |  132 |    ~90 |
| src/core/config.ts                 |  106 |    ~80 |
| src/core/egress.ts                 |  106 |    ~70 |
| src/core/http.ts                   |   62 |    ~60 |
| src/core/extract.ts                |   82 |    ~60 |
| src/core/security.ts (SSRF guard)  |  141 |      - |
| src/core/backends/types.ts         |   61 |    ~40 |
| src/core/backends/registry.ts      |   41 |    ~60 |
| src/core/backends/searxng.ts       |   70 |    ~90 |
| src/core/backends/tavily-compat.ts |  156 |    ~90 |
| src/core/backends/custom.ts        |  159 |    ~70 |
| **subtotal**                       | 1408 |        |

### `packages/pi-webveil` (pi extension frontend)

| module       | LOC | target |
| ------------ | --: | -----: |
| src/index.ts | 168 |    ~90 |

**Total own source: 1576 LOC** (excluding deps).

> Reality vs. target: several modules currently exceed their `CONTEXT.md` ceilings (notably
> `tavily-compat.ts`, `custom.ts`, `pi-webveil/src/index.ts`), and two built modules
> (`index.ts` barrel and `security.ts` SSRF guard) were not in the original target list. The
> table above reflects the modules as actually built. For calibration, comparable pi
> web-search extensions: `pi-searxng-search` 350 LOC (1 backend, no egress, no fetch),
> `leing2021/pi-search` 1714, `pi-search-hub` 9047, `pi-web-providers` 18961. webveil
> delivers a 3-backend + egress + fetch + per-folder-config tool by leaning on `incur`
> (CLI/MCP/skills) and `distilly` (extraction).

## Develop

```sh
pnpm install
pnpm build
pnpm test
pnpm format:check
```
