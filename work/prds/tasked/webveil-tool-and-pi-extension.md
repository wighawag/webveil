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
  decided; none block tasking.
- **taskedAfter:** `[distilly-engine]` — webveil's Extractor seam depends on distilly's
  `distilly/fetch` entrypoint (`urlToMarkdown`), into which webveil injects its
  egress-controlled `fetch`; distilly's network Rules (github/mdn/react.dev/vuejs.org)
  do source-rewriting to raw markdown on top of webveil's egress. Task distilly first so
  webveil's tasks can reference it. (NOTE: cross-repo prd; the dependency is on the
  distilly REPO's prd of the same slug.)

> Tasked. The implementation + testing detail that used to live here now lives in the
> task files under `work/tasks/` (the tracer-bullet decomposition), and the load-bearing
> Extractor/egress decision lives in `docs/adr/0001`. This prd has settled to its durable
> framing (Problem / Solution / User Stories / Out of Scope) above and below.

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
