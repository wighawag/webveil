---
title: webveil — anonymous-capable web search/fetch (incur CLI + MCP core) plus pi-webveil, a drop-in Ollama web_search/web_fetch replacement
slug: webveil-tool-and-pi-extension
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` + code; remaining work: `work/tasks/ready/`.

## Problem Statement

Agents need web search and page fetching, but the common tools are account-bound and
deanonymizing. Ollama's `web_search`/`web_fetch` (the original motivation) just proxy
`ollama.com` and sign every request with the user's account identity, so a VPN hides the
IP but not the identity, and the search targets still leak to a third party. The user
wants a self-hosted, **account-free, key-free** path where the **egress is theirs**
(direct, HTTP proxy, or SOCKS5/Tor) so searches and fetches can be anonymous, while still
working fine non-anonymously. It must be usable across agents (not pi-only), AND ship a
pi extension that is a literal drop-in for Ollama's two tools.

## Solution

One framework-agnostic **core** (`search()` / `fetch()`), wrapped by two thin frontends:

- **`webveil`** — an `incur`-based CLI + MCP server (gets `--mcp`, skills, `--llms`, TOON,
  token pagination for free). Pi-agnostic; any agent can consume it.
- **`pi-webveil`** — a pi extension registering `web_search` and `web_fetch` (same names
  as Ollama) that call the core IN-PROCESS, as a drop-in replacement.

Three seams keep it modular: **backend** (where results come from), **egress** (how
traffic leaves), **config** (per-folder). Extraction is delegated to `distilly` (MIT) via
an Extractor seam: webveil calls distilly's networked `distilly/fetch` entrypoint
(`urlToMarkdown`) and INJECTS its own egress-controlled `fetch`, so distilly's source
rewriting (raw `.md`/API shortcuts) runs on top of webveil's anonymity-preserving egress
and distilly never has egress of its own (see `docs/adr/0001`).

## User Stories

1. As an agent user, I want `web_search` and `web_fetch` with no account and no API key,
   so I am not deanonymized the way Ollama's tools do.
2. As a privacy-conscious user, I want to route all outbound traffic through SOCKS5
   (Tor `127.0.0.1:9050` or Mullvad `10.64.0.1:1080`) per folder, so my searches and
   fetches are anonymous.
3. As a user, I want it to also work with `direct` egress (non-anonymous), so the same
   tool serves everyday use.
4. As a user, I want per-folder config (`.pi/webveil.json` over global over env), so each
   project can have its own backend and egress ("account").
5. As an agent author, I want a CLI + MCP server (via incur) so pi, Claude Code, Cursor,
   Codex, or bash can all use it without pi-specific code.
6. As a pi user, I want `pi-webveil` to register exactly `web_search` and `web_fetch` so I
   can replace `@ollama/pi-web-search` with no other changes.
7. As a maintainer, I want the search/fetch logic as plain core functions that BOTH the
   incur CLI/MCP frontend and the pi extension call, so there is one implementation.
8. As a maintainer, I want a backend seam with `searxng`, `tavily-compat`, and `custom`
   implementations, so I can swap the source (orio-search, searcharvester, agent-search,
   raw SearXNG, or a local script) without touching callers.
9. As a maintainer, I want the egress seam (`direct` | `http` | `socks5`) injected into
   backends as an `http` helper, so a backend physically cannot bypass the configured
   proxy.
10. As a privacy-conscious user, I want webveil to FAIL LOUDLY if a configured proxy
    cannot be built, never silently fetching un-proxied, so anonymity is not lost
    silently.
11. As an agent, I want fetched pages returned as clean, size-bounded markdown
    (`s`/`m`/`l`/`f`) so my context stays small; webveil uses `distilly` for this, or a
    backend's own `/extract` when present.
14. As a privacy-conscious user, I want webveil to ALWAYS inject its egress-controlled
    `fetch` into `distilly/fetch` and NEVER let distilly use a default/global fetch, so
    distilly's (rule-rewritten) requests cannot leak around my egress. distilly throws
    if no fetch is injected — the desired fail-loud.
12. As a maintainer, I want `web_fetch`'s internals to take a list under the hood, so a
    future `web_batch_fetch` is a trivial addition without a redesign.
13. As a careful operator, I want SSRF protection on `web_fetch` (block private IPs),
    relaxed when egress is a proxy (Tor/Mullvad legitimately needs it).

### Autonomy notes (the two gate axes)

- **humanOnly:** omitted. Agent-taskable; the design is resolved.
- **needsAnswers:** omitted. The three seams, the egress modes, the dependency choices
  (incur, distilly, socks-proxy-agent as a plain dep), and the tool surface are all
  decided. A couple of small implementation calls remain (see below) but none block
  tasking.
- **taskedAfter:** `[distilly-engine]` — webveil's Extractor seam depends on distilly's
  `distilly/fetch` entrypoint (`urlToMarkdown`), into which webveil injects its
  egress-controlled `fetch`; distilly's network Rules (github/mdn/react.dev/vuejs.org)
  do source-rewriting to raw markdown on top of webveil's egress. Task distilly first so
  webveil's tasks can reference it. (NOTE: cross-repo prd; the dependency is on the
  distilly REPO's prd of the same slug.)

## Implementation Decisions

**Layout** (already scaffolded): pnpm monorepo, `packages/webveil` (CLI+MCP, `webveil`
bin -> `dist/cli.js`) and `packages/pi-webveil` (pi extension, depends on `webveil` via
`workspace:*`).

**Core (frontend-agnostic), in `packages/webveil/src/core/`:**
- `search.ts`, `fetch.ts` — the plain `search()`/`fetch()` functions (placeholders exist
  in `src/index.ts`; move/expand into `core/`).
- `backends/` — `types.ts` (the `Backend` interface: `search`, optional `fetch`, each
  given the proxied `http` helper), `registry.ts` (name -> Backend dispatcher, trimmed
  from pi-search-hub's pattern), `searxng.ts`, `tavily-compat.ts` (generic POST
  `/search` + `/extract`, selected by `baseUrl`; covers orio-search / searcharvester /
  agent-search), `custom.ts` (JSON stdin/stdout local command, lifted from
  pi-web-providers' contract).
- `egress.ts` — `buildDispatcher(cfg)` returning an undici Dispatcher: `direct`
  (undefined), `http` (undici `ProxyAgent`, no extra dep), `socks5` (via
  `socks-proxy-agent`, a PLAIN dependency — NOT optionalDependencies). Fail loud if a
  socks dispatcher cannot be built. Also exposes an **egress-bound WHATWG `fetch`** built
  with undici's `fetch` closed over the dispatcher
  (`(input, init) => undiciFetch(input, { ...init, dispatcher })`), for injection into
  `distilly/fetch`. Same fail-loud guarantee: if the proxy can't be built the egress
  fetch THROWS, never falls back to un-proxied. distilly's seam stays a WHATWG `fetch`
  (no Dispatcher option on distilly — keeps it undici-agnostic; see `docs/adr/0001`).
- `http.ts` — one `fetchJson`/`fetchText` helper that applies the dispatcher + timeout +
  abort; this is the `http` handed to backends. (Distinct from the egress-bound `fetch`
  injected into distilly: the `http` helper serves backends, the `fetch` serves distilly,
  both bound to the SAME dispatcher.)
- `config.ts` — resolve `{ backend, baseUrl, apiKey?, egress, fetchSize }` with
  precedence env > nearest `.pi/webveil.json` (walk up from cwd) > global
  `~/.pi/agent/webveil.json` > defaults (`searxng`, `http://127.0.0.1:8080`,
  `egress:direct`), layered over incur's config-file feature.
- `extract.ts` — Extractor seam: calls `urlToMarkdown(url, { fetch, size })` from
  `distilly/fetch` by default (signature, pinned to distilly's shipped API:
  `urlToMarkdown(url, { fetch: typeof globalThis.fetch; rules?; size?: 's'|'m'|'l'|'f' })
  => Promise<{ markdown, truncated }>`). webveil maps its `s/m/l/f` preset straight to
  distilly's `size` and surfaces `truncated`. The injected `fetch` is webveil's
  egress-bound fetch (see `egress.ts`). A backend's `/extract` (tavily-compat) overrides
  this seam. (Decision recorded in `docs/adr/0001`: style b, networked entrypoint with
  injected egress — chosen over the pure `htmlToMarkdown(html)` path for distilly's
  shorter rule-rewritten output and less code in webveil.)
- SSRF guard (block private IPs), relaxed under proxy egress (adapt leing2021/pi-search's
  `security.ts` approach). It lives INSIDE the egress-bound `fetch` (below), so it covers
  BOTH webveil's own direct `web_fetch` GETs AND distilly's rule-rewritten requests.

**Frontend 1 — `cli.ts` (incur):** `Cli.create()` with commands `search` and `fetch`
that call the core; this yields CLI + MCP (`--mcp`) + skills + `--llms` + TOON. Pin the
incur version.

**Frontend 2 — `pi-webveil/src/index.ts`:** default export `registerTool({ name:
'web_search' })` and `{ name: 'web_fetch' }` calling the SAME core in-process (no
shelling). Resolve per-folder config from `ctx.cwd`. Tool names MUST be exactly
`web_search` / `web_fetch` for Ollama drop-in.

**Deps:** `incur` (MIT), `distilly` (MIT, published as `distilly@^0.1.0` — a sibling repo,
NOT a workspace member; webveil imports the `distilly/fetch` subpath export),
`socks-proxy-agent` (plain dep); undici is in Node 24
for both the HTTP proxy AND the egress-bound `fetch` injected into distilly. The AGPL
packages must not pull any GPL/AGPL code INTO distilly (keep it clean MIT).

## Testing Decisions

Test at the seams, not internals:
- `core.search()` against a fake `http` returns normalized `SearchResult[]`; dedup + clamp.
- `core.fetch()` returns size-bounded markdown with the `truncated` flag; uses the
  Extractor (distilly's `urlToMarkdown`) or a backend `/extract`. Assert distilly is
  invoked WITH webveil's egress-bound `fetch` (never a global/default fetch), and that an
  egress fetch built on an unbuildable proxy THROWS rather than fetching un-proxied.
- Egress: `buildDispatcher` returns the right dispatcher per mode; `socks5` with a missing
  dep FAILS LOUD (assert the error), never returns a direct dispatcher.
- Config precedence: env > project `.pi/webveil.json` > global > defaults; per-folder walk
  works from a nested cwd.
- Backends: `searxng` parses SearXNG JSON; `tavily-compat` parses a Tavily-shaped
  response; `custom` round-trips the JSON stdin/stdout contract.
- pi-webveil registers exactly `web_search` and `web_fetch` and routes to the core.
- SSRF: a private-IP URL is blocked on direct egress, allowed under proxy egress —
  asserted via the egress-bound `fetch`, so the guard covers distilly's rule-rewritten
  requests too, not only webveil's direct GETs.

## Out of Scope

- The extraction engine itself — that is `distilly` (separate MIT repo).
- A `research`/`answer` tool, in-tool LLM calls, content-store, or polling lifecycle (pi
  orchestrates search -> fetch -> synthesize; keep the surface to two tools).
- A separate `web_batch_fetch` TOOL in v1 (internals are list-ready so it is a trivial
  later add).
- Running/operating the backend containers (orio-search/searcharvester/agent-search) or
  the Tor/Mullvad setup — webveil points at them; their deployment is the user's, with
  example compose/docs optional and out of scope for v1 code.
- Heavy TUI in the pi extension (an optional compact `renderResult` is the most we add;
  no commands/widgets/statusline in v1).

## Further Notes

webveil is repo 2 of a two-repo effort; repo 1 is **distilly** (MIT), the local
HTML-to-markdown engine it depends on. The original trigger was replacing
`@ollama/pi-web-search`, whose hosted+signed design deanonymizes the user; `pi-webveil`
is the literal drop-in. The fuller design record (including the review of existing
extensions: pi-search-hub's registry, pi-web-providers' custom-wrapper contract,
pi-searxng-search's clean style, leing's SSRF guard) lives in the originating session's
design doc; the durable framing is above. Keep modules small; track per-module LOC in the
README as a quality signal.
