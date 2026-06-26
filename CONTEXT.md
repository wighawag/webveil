# webveil

## What webveil is

webveil is an **anonymous-capable, self-hosted, account-free** web **search + fetch**
toolset for AI agents. It replaces account-bound tools (notably Ollama's
`web_search`/`web_fetch`, which proxy a hosted service and sign every request with your
account identity) with a self-hosted path that has **no account, no API key**, and an
**egress you control** (direct, HTTP proxy, or SOCKS5/Tor) so searches and fetches can be
anonymous. It also works perfectly well non-anonymously (direct egress).

The **core** (`search()` / `fetch()`) is plain, framework-agnostic functions. Two thin
frontends wrap that same core:

- **`webveil`** (this package): an [incur](https://github.com/wevm/incur)-based **CLI +
  MCP server** (`--mcp`, skills, `--llms`, TOON output). Pi-agnostic; usable by any agent
  (pi via pi-mcp-adapter, Claude Code, Cursor, Codex, bash).
- **`pi-webveil`** (sibling package): a **pi extension** registering `web_search` and
  `web_fetch` tools that call the core in-process. A drop-in replacement for Ollama's
  tools (same names), which is the original motivation.

AGPL-3.0 licensed. Depends on `distilly` (MIT, the local HTML-to-markdown extractor;
webveil uses its networked `distilly/fetch` entrypoint with an injected egress fetch) and
`incur` (MIT). MIT-on-AGPL is fine; distilly stays GPL/AGPL-free so it remains reusable.

## Domain terms

- **core** — the framework-agnostic `search(query, opts)` and `fetch(url, opts)`
  functions. Both frontends (incur CLI/MCP and the pi extension) call the same core.
- **backend seam** — where results/content come from. Implementations: `searxng`
  (keyless self-hosted metasearch), `tavily-compat` (a generic Tavily-shaped
  `/search`+`/extract`, covering orio-search / searcharvester / agent-search by base
  URL), and `custom` (a local command via a JSON stdin/stdout contract). The backend is
  HANDED a proxied `http` helper so it cannot bypass egress.
- **egress seam** — how outbound HTTP leaves the machine: `direct`, `http` (undici
  ProxyAgent, zero extra deps), or `socks5` (Tor `127.0.0.1:9050`, Mullvad
  `10.64.0.1:1080`, via `socks-proxy-agent`). SOCKS5 is the mode that matters for
  anonymity. Fail-loud if a configured proxy cannot be built (never silently un-proxied).
  Yields BOTH a proxied `http` helper (for backends) AND an egress-bound WHATWG `fetch`
  (undici `fetch` over the same dispatcher) injected into `distilly/fetch`. The SSRF
  guard lives in that egress fetch, so it covers distilly's rule-rewritten requests too.
- **config seam** — per-folder resolution: env > nearest `.pi/webveil.json` walking up
  from cwd > global `~/.pi/agent/webveil.json` > defaults, layered over incur's config
  feature. Per folder = per account/egress.
- **Extractor seam** — `urlToMarkdown` via `distilly/fetch` by default, INJECTED with
  webveil's egress-bound `fetch` (so distilly's network Rules rewrite to raw `.md`/API
  source over webveil's egress, never a global fetch); a backend's own `/extract`
  (Tavily-compat) may override it. Owns the context-friendly markdown + size presets
  (`s`/`m`/`l`/`f`) and surfaces distilly's `truncated`. See `docs/adr/0001`.
- **drop-in (Ollama)** — `pi-webveil` deliberately uses the tool names `web_search` and
  `web_fetch` so it replaces `@ollama/pi-web-search` without changing anything else.

## Stack

pnpm workspace monorepo with two published packages: `packages/webveil` (the CLI+MCP
tool, has a `webveil` bin) and `packages/pi-webveil` (the pi extension, depends on
`webveil` via `workspace:*`). TypeScript (NodeNext, strict), `tsc` build, vitest, prettier
(tabs, single quotes, no bracket spacing). Key deps: `incur` (CLI/MCP framework),
`distilly` (extraction), `socks-proxy-agent` (SOCKS egress); undici (in Node) for HTTP
proxy.

## Size discipline (track LOC in the README)

Keep every module small, one responsibility. Track per-module LOC in the README as a
first-class quality signal. Rough targets (ceilings, not promises) for the `webveil`
core + frontends:

| module                     | target LOC |
|----------------------------|-----------:|
| core/search.ts             |        ~90 |
| core/fetch.ts              |        ~90 |
| core/config.ts             |        ~80 |
| core/egress.ts             |        ~70 |
| core/http.ts               |        ~60 |
| core/extract.ts            |        ~60 |
| core/backends/types.ts     |        ~40 |
| core/backends/registry.ts  |        ~60 |
| core/backends/searxng.ts   |        ~90 |
| core/backends/tavily-compat.ts | ~90 |
| core/backends/custom.ts    |        ~70 |
| cli.ts (incur frontend)    |        ~80 |
| pi-webveil/src/index.ts    |        ~90 |

For calibration, the existing pi web-search extensions we reviewed:
`pi-searxng-search` 350 LOC (1 backend, no egress, no fetch), `leing2021/pi-search`
1714, `pi-search-hub` 9047, `pi-web-providers` 18961. webveil aims to deliver a
3-backend + egress + fetch + per-folder-config tool well under ~1k LOC of our own
code (excluding deps), by leaning on `incur` (CLI/MCP/skills) and `distilly`
(extraction).

## Verify gate

`pnpm format:check && pnpm build && pnpm test` (prepare: `pnpm install`). See
`.dorfl.json`.
