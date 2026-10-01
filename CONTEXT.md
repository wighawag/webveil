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

- **core**: the framework-agnostic `search(query, opts)` and `fetch(url, opts)`
  functions. Both frontends (incur CLI/MCP and the pi extension) call the same core.
- **backend seam**: where results/content come from. Implementations: `searxng`
  (keyless self-hosted metasearch), `tavily-compat` (a generic Tavily-shaped
  `/search`+`/extract`, covering orio-search / searcharvester / agent-search by base
  URL), `custom` (a local command via a JSON stdin/stdout contract), and `searchcast`
  (keyless engines from recipes over libcurl-impersonate via the `searchcast` library; the
  backend-hop `egress` becomes its proxy, so its egress IS the search egress, see
  `docs/adr/0004`; the default backend). The backend is HANDED a proxied `http` helper so it cannot bypass
  egress (`custom` and `searchcast` own their I/O and leave it unused).
- **egress seam**: how outbound HTTP leaves the machine, one of `direct`, `http` (undici
  ProxyAgent, zero extra deps), or `socks5` (Tor `127.0.0.1:9050`, Mullvad
  `10.64.0.1:1080`, via `socks-proxy-agent`). SOCKS5 is the mode that matters for
  anonymity. Fail-loud if a configured proxy cannot be built (never silently un-proxied).
  Yields BOTH a proxied `http` helper (for backends) AND an egress-bound WHATWG `fetch`
  (undici `fetch` over the same dispatcher) injected into `distilly/fetch`. The SSRF
  guard lives in that egress fetch, so it covers distilly's rule-rewritten requests too.
- **config seam**: per-folder resolution, in the order env > nearest `webveil.json` walking up
  from cwd > global `$XDG_CONFIG_HOME/webveil/config.json` (default
  `~/.config/webveil/config.json`) > defaults, layered over incur's config feature. The
  project file is a frontend-neutral `webveil.json` (no `.pi/`), read identically by the
  pi-agnostic CLI and the pi extension. Per folder = per account/egress. See
  `docs/adr/0002`.
- **provenance**: for every resolved leaf key path (e.g. `baseUrl`, `searchcast.engines`), the layer it came from: env, project (with the file path), global (with the file path) or defaults. Plain-object config sections merge key by key; scalars, arrays, `egress` and `fetchEgress` are leaves replaced whole. See `core/layers.ts`.
- **trusted layer**: env or the global config file. The project `webveil.json` is the untrusted layer, because it is discovered by walking up from the cwd, so any cloned repository can supply one (defaults and a config built in code count as trusted). See `core/trust.ts`.
- **executable setting**: a config key whose value makes webveil run code: the `custom` backend's command (its `baseUrl`), and `searchcast.libcurlPath`, `searchcast.codeRecipes`, `searchcast.browser.chrome`, `searchcast.browser.xvfb` and `searchcast.browser.chromeArgs`. Accepted only from a trusted layer, never from a project `webveil.json`; checked where the backend uses it, and its paths never resolve against the cwd. See `core/trust.ts` and `docs/adr/0004`.
- **searchcast**: the policy-free library behind the `searchcast` backend, published as `searchcast` 0.2 (formerly `serpcast`; sibling repo `wighawag/searchcast`, its ADR 0005): recipes run over libcurl-impersonate with Chrome's fingerprint, an engine chain, and the browser runner `@searchcast/browser` as the browser fallback. The caller injects the proxy, the state store and the recipe set; webveil is that caller and adds the policy (egress as the proxy, strict impersonation always on, per-identity state, trust). The `searchcast` backend and the `searchcast` config section (this backend's settings, with the browser runner's options in its `browser` subsection) are named after it. See `docs/adr/0004` and `docs/adr/0005`.
- **serpcast spellings**: the names webveil 0.10 used for the backend, its config section, `fetchTransport` value, `fetchSerpcast` section and `WEBVEIL_SERPCAST_*` / `WEBVEIL_FETCH_SERPCAST_*` env (and `serpcast.searchcast.*` for what is now `searchcast.browser.*`). Accepted for one release with one warning per spelling: each config layer is rewritten to the `searchcast` spellings BEFORE the layers merge, so provenance, the trust rule and the identity key only see the new names; both spellings of one setting in one layer is an error. Removed in the next minor. See `core/spellings.ts` and `docs/adr/0005`.
- **recipe**: the description of one search engine. A **declarative recipe** is a JSON file (the `@searchcast/recipe` format, formerly `serpcast-recipe`, shared with the browser runner: URL template, CSS selectors for results, empty and blocked pages), loaded from `searchcast.recipes` (files or directories, every `*.json` inside) by any layer, since it is data. A **code recipe** is a JS module (`searchcast.codeRecipes`), an executable setting. Both share one name space; a duplicate name is an error. An **installed recipe set** is a directory `webveil install-recipes` (searchcast's installer) wrote under searchcast's `recipesDir()` (`$XDG_DATA_HOME/searchcast/recipes/<set>/`, from a checksum-pinned archive), or, for one release, one serpcast wrote under `$XDG_DATA_HOME/serpcast/recipes/` (read when the new directory has no set of that name, never written); either key names it `set:<name>` (the whole set) or `set:<name>/<file>` (one file). The prefix only locates files: `codeRecipes` stays trusted-layer only whatever its form.
- **engine chain**: `searchcast.engines`, the ordered engine names a search tries; the first answer (results, or a genuine empty match) wins, and the engines that failed before it annotate the results as `unresponsiveEngines`. Every engine failing is an error listing each failure (with its searchcast kind: `blocked`, `recipe`, `timeout`, `transport` or `decoy`), never `[]`. A **decoy** is a well-formed answer unrelated to the query (some engines serve them); it is a failure only for an engine listed in `searchcast.decoyGuard` (any layer, data), and unlike `blocked` it starts no cooldown. The **default chain** is `["mwmbl", "marginalia"]`, from the code recipes bundled in the webveil package (`recipes/mwmbl.mjs` and `recipes/marginalia.mjs`, copies of searchcast's examples, trusted because they ship with webveil): it is used only when the resolved section sets none of `engines`, `recipes` and `codeRecipes`, and any of them replaces it whole (no merge). A **browser engine** is named `browser:<recipe>` (`searchcast:<recipe>` up to webveil 0.12, accepted with a warning for one release) and runs that recipe in the browser runner (`@searchcast/browser`): in `library` mode (default) webveil starts it in-process with `egress` as its proxy; in `endpoint` mode it calls a `searchcast serve` it does not control, so that mode requires `egress: direct`.
- **identity**: one search identity, named by the **identity key**: the sha256 of the backend-hop `egress` and the backend's whole resolved section (today the `searchcast` section; `core/identity.ts`, reached through `searchcastIdentityKey`). Everything webveil keeps per identity (the cached searchcast instance, its on-disk state, a persistent browser profile) is keyed by this one hash and never crosses identities, because replaying a session obtained on one egress over another links the two. See `docs/adr/0004`.
- **state** (searchcast state): the sessions (engine cookies, a code recipe's JSON state) and engine cooldowns searchcast keeps in its injected `StateStore`. webveil's store (`core/state.ts`) keeps it on disk under `$XDG_STATE_HOME/webveil/` (default `~/.local/state/webveil/`), one **identity partition** per identity: the directory `<identity key>/`, holding `state.json` (0600, directories 0700), updated under a lock file with atomic replace, and, with `searchcast.browser.persistProfile`, the browser profile `browser-profile/` (deleted once the partition is idle past `sessionIdleMs`). Expiry is enforced on read. `webveil state clear [--all]` removes the current identity's partition, or all.
- **Extractor seam**: `urlToMarkdown` via `distilly/fetch` by default, INJECTED with
  webveil's egress-bound `fetch` (so distilly's network Rules rewrite to raw `.md`/API
  source over webveil's egress, never a global fetch); a backend's own `/extract`
  (Tavily-compat) may override it. Owns the context-friendly markdown + size presets
  (`s`/`m`/`l`/`f`) and surfaces distilly's `truncated`. See `docs/adr/0001`.
- **fetch transport**: how `web_fetch` sends the requests whose responses distilly converts, set by `fetchTransport`: `plain` (undici over the fetch-hop egress, a Node TLS fingerprint) or `searchcast` (a `fetch`-shaped adapter over searchcast's libcurl-impersonate transport: Chrome's TLS/HTTP2 fingerprint and `document` header table, GET only, caller headers ignored). Unset, it is `searchcast` when `backend` is `searchcast` and `plain` otherwise; an explicit value (env `WEBVEIL_FETCH_TRANSPORT`) always wins. The `searchcast` fetch transport uses the fetch-hop egress mapped as for the backend (SOCKS always `socks5h`), follows redirects itself (at most 20) with the SSRF guard on every hop, is always strict (no fallback to `plain`), reads only the executable setting `searchcast.libcurlPath`, and starts every fetch with an empty cookie jar: no cookies persist between fetches and nothing enters the searchcast state (a fetch is not an identity). Connections are reused: a small pool of searchcast sessions per fetch identity (fetch-hop egress + library path), a busy session never shared, an idle one closed after `fetchSearchcast.sessionIdleMs` (searchcast's session idle default) or by `closeBackends`; the pool size, timeout, body cap and connection reuse are the `fetchSearchcast` section, the redirect limit `fetchMaxRedirects` (shared with `plain`). Not to be confused with the backend `transport` of `baseurl.ts` (how webveil reaches a backend `baseUrl`). See `core/fetch-transport.ts`.
- **setup commands**: `webveil install-libcurl`, `install-recipes`, `recipes` and `doctor`, which make webveil the only thing a user installs. They wrap searchcast's `searchcast/install` entry, loaded lazily so `search`/`fetch` never load download code, and are CLI only (not MCP or pi tools): installing downloads code webveil runs, and the checksum pin is the human's trust decision. A download never goes silently through `egress`: with a direct egress it goes direct unless `--proxy` is given; with a proxy `egress` or `fetchEgress` its route must be explicit (`--egress`, `--proxy <url>` or `--direct`), else it is refused (exit 2) before any request. `--egress` means the configured egress hop (`egress`, else a proxy `fetchEgress`), used with its credentials. See `src/setup.ts`.
- **tuning keys**: the numbers and switches a user may need to change (timeouts, size caps, pool sizes, connection reuse, the decoy rule, state persistence and lock times, `maxResults`), each a config key with an env form, validated where used, defaulting to webveil's old behaviour. Not tuning, on purpose: strict impersonation, the SSRF guard, the trust rule, checksum pins. See `core/tunables.ts` and the README's configuration reference.
- **drop-in (Ollama)**: `pi-webveil` deliberately uses the tool names `web_search` and
  `web_fetch` so it replaces `@ollama/pi-web-search` without changing anything else.

## Stack

pnpm workspace monorepo with two published packages: `packages/webveil` (the CLI+MCP
tool, has a `webveil` bin) and `packages/pi-webveil` (the pi extension, depends on
`webveil` via `workspace:*`). TypeScript (NodeNext, strict), `tsc` build, vitest, prettier
(tabs, single quotes, no bracket spacing). Key deps: `incur` (CLI/MCP framework),
`distilly` (extraction), `socks-proxy-agent` (SOCKS egress); undici (in Node) for HTTP
proxy.

The `searchcast` backend adds `searchcast` and `@searchcast/recipe` (the engine layer and its recipe format, installed with webveil; `searchcast` brings the pinned libcurl-impersonate as its optional dependency `@searchcast/libcurl-<platform>` on supported platforms) and, optionally, `@searchcast/browser` (the browser fallback in library mode, an optional peer, not installed with webveil).

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
| core/fetch-transport.ts    |          - |
| core/tunables.ts           |          - |
| core/backends/types.ts     |        ~40 |
| core/backends/registry.ts  |        ~60 |
| core/backends/searxng.ts   |        ~90 |
| core/backends/tavily-compat.ts | ~90 |
| core/backends/custom.ts    |        ~70 |
| core/backends/searchcast.ts |      ~90 |
| core/identity.ts           |        ~30 |
| core/state.ts              |       ~120 |
| core/layers.ts             |          - |
| core/spellings.ts          |          - |
| core/trust.ts              |          - |
| core/security.ts           |          - |
| core/baseurl.ts            |          - |
| index.ts (barrel)          |          - |
| cli.ts (incur frontend)    |        ~80 |
| setup.ts (setup commands)  |          - |
| pi-webveil/src/index.ts    |        ~90 |

`-` means the module has no ceiling set. Actual LOC per module, and which modules exceed their ceilings, are tracked in the README.

For calibration, the existing pi web-search extensions we reviewed:
`pi-searxng-search` 350 LOC (1 backend, no egress, no fetch), `leing2021/pi-search`
1714, `pi-search-hub` 9047, `pi-web-providers` 18961. The original aim was a 3-backend + egress + fetch + per-folder-config tool under ~1k LOC of our own code (excluding deps); as built, the 4-backend tool (with the trust rule and per-identity state) is about 3.3k LOC, still leaning on `incur` (CLI/MCP/skills), `distilly` (extraction) and `searchcast` (the search engines of the `searchcast` backend).

## Verify gate

`pnpm format:check && pnpm build && pnpm test` (prepare: `pnpm install`). See
`dorfl.json`.
