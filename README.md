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

- **[`webveil`](packages/webveil)**, an [incur](https://github.com/wevm/incur)-based
  **CLI + MCP server** (`--mcp`, skills, `--llms`, TOON output). Pi-agnostic; usable by any
  agent (pi via pi-mcp-adapter, Claude Code, Cursor, Codex, bash). Has a `webveil` bin.
- **[`pi-webveil`](packages/pi-webveil)**, a **pi extension** registering `web_search` and
  `web_fetch` tools that call the core in-process. A drop-in replacement for Ollama's tools
  (same names), which is the original motivation. Depends on `webveil` via `workspace:*`.

## Quick start

webveil needs a **backend** for results. The zero-config default is a local **SearXNG** at
`http://127.0.0.1:8080` on `direct` egress (non-anonymous). Run one with Docker:

```sh
# The container binds 8080 internally; map host 8080 -> 8080 to match the default.
docker run -d --name searxng -p 8080:8080 searxng/searxng
```

Then searches and fetches work with no config:

```sh
webveil search "hello world"
```

That's the whole happy path. Two things to know:

- **Enable SearXNG's JSON API.** A fresh install may serve only HTML and ship with the rate
  limiter on, giving webveil `429` or an HTML page. The stock Docker image above works out
  of the box; other installs need `json` in `search.formats` and `server.limiter: false`
  for local use. See [SearXNG setup](docs/searxng-setup.md).
- **Different port?** Point webveil at it (a non-Docker install often defaults to 8888):
  ```sh
  export WEBVEIL_BASE_URL=http://127.0.0.1:8888   # or wherever your instance listens
  ```
  or set `baseUrl` in `webveil.json`.

For any non-Docker topology (install script, Unix sockets, reverse proxy, the
uwsgi-vs-`http-socket` catch), see **[SearXNG setup (detailed)](docs/searxng-setup.md)**.
There is **no** zero-setup + anonymous + real-web-results option in the ecosystem (see
[`work/notes/ideas/default-backend-policy-account-vs-origin.md`](work/notes/ideas/default-backend-policy-account-vs-origin.md));
SearXNG (you run it) is the closest, `tavily-compat` (needs an account/key) is the other.

### Where does anonymity live? (read before turning on egress)

**webveil's egress only anonymizes webveil's OWN outbound hop** (webveil → backend, and
`web_fetch` → the target URL). It does NOT anonymize what a backend does next. This has a
load-bearing consequence for SearXNG:

- A **local** SearXNG makes its actual search-engine requests (→ Google/Bing/…) from
  **its own process, on your machine, with your real IP**. That hop is OUTSIDE webveil's
  egress. So setting `WEBVEIL_EGRESS=socks5` while `baseUrl` is `127.0.0.1` does **NOT**
  make your searches anonymous, webveil would just be proxying a pointless localhost call,
  while SearXNG crawls the web from your real IP. That is **false confidence**, the worst
  outcome.
- **webveil refuses this combo (fail-loud):** a non-`direct` egress (`http`/`socks5`) with
  a **loopback `baseUrl`** is rejected with an error, rather than silently giving you fake
  anonymity. (A *remote* SearXNG over SOCKS is legitimate and allowed, the guard keys on
  loopback specifically.)

So the correct setups:

| Goal | webveil egress | backend | Who anonymizes the web hop |
| --- | --- | --- | --- |
| Local SearXNG, anonymous searches | `direct` | local SearXNG | **SearXNG itself**, set its `outgoing.proxies` (Tor/SOCKS) in `settings.yml` |
| Remote SearXNG, hide your IP from it | `socks5` | the **remote** SearXNG url | webveil's hop (Mullvad/Tor) |
| Anonymous `web_fetch` of arbitrary URLs | `socks5` | (any) | webveil's hop |
| Non-anonymous everyday use | `direct` | local SearXNG | nobody (honest) |

Rule of thumb: **proxy the hop that actually reaches the public internet.** For a
self-hosted SearXNG that hop is SearXNG's, so the proxy goes on SearXNG
(`outgoing.proxies`), and webveil stays `direct`. webveil's `socks5` mode is for *remote*
backends and for `web_fetch`. See
[`work/notes/findings/webveil-anonymity-boundary.md`](work/notes/findings/webveil-anonymity-boundary.md).

## How it works (seams)

- **core**, the framework-agnostic `search(query, opts)` and `fetch(url, opts)` functions.
  Both frontends call the same core.
- **backend seam**, where results/content come from: `searxng` (keyless self-hosted
  metasearch), `tavily-compat` (a generic Tavily-shaped `/search` + `/extract`), and
  `custom` (a local command via a JSON stdin/stdout contract). The backend is handed a
  proxied `http` helper so it cannot bypass egress.
- **egress seam**, how outbound HTTP leaves the machine: `direct`, `http` (undici
  `ProxyAgent`), or `socks5` (Tor `127.0.0.1:9050`, Mullvad `10.64.0.1:1080`). SOCKS5 is
  the mode that matters for anonymity. Fail-loud if a configured proxy cannot be built.
  **Egress is per-request and scoped to webveil ONLY**, it is NOT a system-wide proxy. It
  governs webveil's own search/fetch traffic (and the `fetch` it injects into distilly),
  and nothing else: your shell, `git push`, the browser, and the OS are untouched. So
  webveil on `socks5` does NOT route your `git push` through the proxy. See
  [Anonymous egress](#anonymous-egress-mullvad--tor) and
  [`work/notes/findings/mullvad-socks5-egress-mechanics.md`](work/notes/findings/mullvad-socks5-egress-mechanics.md).
- **config seam**, per-folder resolution: env > nearest `webveil.json` walking up from
  cwd > global `$XDG_CONFIG_HOME/webveil/config.json` (default
  `~/.config/webveil/config.json`) > defaults. Per folder = per account/egress. The
  project file is a frontend-neutral `webveil.json` read identically by the CLI and the
  pi extension. See [`docs/adr/0002`](docs/adr/0002-config-file-location-neutral-webveil-json.md).
- **extractor seam**, `urlToMarkdown` via `distilly/fetch` by default, injected with
  webveil's egress-bound `fetch`; a backend's own `/extract` (Tavily-compat) may override
  it. Owns the context-friendly markdown + size presets (`s`/`m`/`l`/`f`). See
  [`docs/adr/0001`](docs/adr/0001-extractor-uses-distilly-fetch-with-injected-egress.md).
- **security**, an SSRF guard lives in the egress fetch, so it covers distilly's
  rule-rewritten requests too.

## Anonymous egress (Mullvad / Tor)

By default webveil uses `direct` egress (your real IP, non-anonymous). Anonymity is
**opt-in**: it is enabled ONLY when you set it in config/env. webveil never auto-enables a
proxy (silent anonymity would be a footgun in the other direction).

Enable SOCKS5 egress for webveil:

```sh
export WEBVEIL_EGRESS=socks5
export WEBVEIL_EGRESS_URL=socks5://10.64.0.1:1080     # Mullvad
# or socks5://127.0.0.1:9050                          # Tor
```

or per folder in `webveil.json`:

```json
{ "egress": { "mode": "socks5", "url": "socks5://10.64.0.1:1080" } }
```

> **`socks5` is for a REMOTE backend or `web_fetch`, NOT a local SearXNG.** If your
> `baseUrl` is a local SearXNG (`unix:` or `127.0.0.1`), `WEBVEIL_EGRESS=socks5` is
> **rejected** (fail-loud), because webveil → local-SearXNG is a local hop; proxying it
> would give fake anonymity while SearXNG still crawls the web from your real IP. The hop
> that needs proxying is SearXNG's own, so you put the proxy on **SearXNG**
> (`outgoing.proxies`) and keep webveil `direct`. See
> [Where does anonymity live?](#where-does-anonymity-live-read-before-turning-on-egress)
> for the full table; the same SOCKS5 listener (Mullvad/Tor/wireproxy below) plugs into
> either side.

### Two layers keep your `git push` (and everything else) off the proxy

A common worry: "if I route through Mullvad, will my `git push` to GitHub leak under the
VPN exit IP?" With webveil, **no**, for two independent reasons:

1. **webveil's egress is per-request and webveil-only.** It applies the SOCKS5 dispatcher
   inside its own search/fetch code; it does not install a system proxy. `git`, your shell,
   and the OS are never touched. webveil on `socks5` proxies webveil's traffic and nothing
   else.
2. **You configure split routing** (below) so that even at the OS level, only the proxy IP
   goes through the tunnel.

### Mullvad: use the SOCKS5 proxy WITHOUT tunnelling all your traffic

Mullvad's SOCKS5 proxy at `10.64.0.1:1080` **only exists while a Mullvad WireGuard tunnel
is up** (it is reachable only through the tunnel). The trick is to keep the tunnel up but
tell WireGuard NOT to route your normal traffic through it, only the proxy IP. Add this to
your Mullvad WireGuard `.conf` (`[Interface]` section):

```ini
Table = off
PostUp  = ip -4 route add 10.64.0.1/32 dev %i; ip -4 route add 10.124.0.0/22 dev %i
PreDown = ip -4 route delete 10.64.0.1/32 dev %i; ip -4 route delete 10.124.0.0/22 dev %i
```

`Table = off` stops WireGuard from grabbing the default route; the manual routes send ONLY
Mullvad's SOCKS5 proxy IPs through the tunnel (`10.124.0.0/22` is the multihop range).
Result: webveil's SOCKS5 requests exit via Mullvad; all other traffic (git, browser, OS)
uses your normal ISP connection. (Simpler alternative: leave WireGuard's routing alone and
rely on layer 1, but split routing is the belt-and-braces version.)

Verify the proxy works: `curl https://ipv4.am.i.mullvad.net --socks5-hostname 10.64.0.1`
should return a Mullvad exit IP; a plain `curl https://am.i.mullvad.net` should return your
real IP (proving only the proxy is tunnelled).

### "Different exit identity for webveil than for the rest of the machine"

If you want webveil to exit somewhere different from your system, you have options, but be
clear on what is and isn't possible (see
[`work/notes/findings/mullvad-socks5-egress-mechanics.md`](work/notes/findings/mullvad-socks5-egress-mechanics.md)):

- **Different exit LOCATION, same account (easy).** Point webveil at a specific multihop
  SOCKS5 host so it exits elsewhere than your tunnel's entry:
  `WEBVEIL_EGRESS_URL=socks5://us-nyc-wg-socks5-001.relays.mullvad.net:1080`. Your tunnel
  enters where your Mullvad app is connected; webveil's traffic exits in NYC. Same Mullvad
  account, unlinkable-by-location.
- **Two DIFFERENT Mullvad ACCOUNTS at once (hard, not a webveil feature).** Mullvad's
  SOCKS5 proxy is a property of the ONE active WireGuard tunnel, which is tied to ONE
  account's key. SOCKS5 multihop changes exit location, NOT account. To run account A
  system-wide AND account B for webveil simultaneously, you must isolate them at the OS
  level: run webveil inside its own network namespace / VM / container that has its own
  WireGuard tunnel on account B, while the host runs account A. That is infrastructure work
  outside webveil. For most people, "don't link my searches to my git" is already solved by
  split routing above (searches exit via Mullvad, git stays on your real IP, not correlated
  by exit IP), without needing a second account.

### Tor

`WEBVEIL_EGRESS_URL=socks5://127.0.0.1:9050` with the Tor daemon running. Same per-request,
webveil-only scoping applies.

### Other SOCKS5 providers

webveil's `socks5` egress is generic: it builds a SOCKS5 dispatcher from any
`socks5://host:port` URL. Mullvad and Tor are just the documented examples. Anything that
exposes a SOCKS5 endpoint works, e.g. an SSH dynamic forward (`ssh -D 1080 user@host`, then
`socks5://127.0.0.1:1080`), or a local shadowsocks/sing-box listener. Use the `socks5://`
scheme (remote DNS, no leak; webveil does not resolve hostnames locally under proxy
egress). Verify any provider with
`curl https://ipv4.am.i.mullvad.net --socks5-hostname <host>:<port>`.

### ProtonVPN (via wireproxy)

ProtonVPN **does not offer a native SOCKS5 proxy** ([and says it never
will](https://protonvpn.com/support/socks5)), unlike Mullvad's built-in `10.64.0.1:1080`.
There is no `socks5://` endpoint Proton hands you. But you can wrap a Proton **WireGuard**
tunnel in a local SOCKS5 listener and point webveil at that, exactly like the Tor case.

[wireproxy](https://github.com/pufferffish/wireproxy) is a userspace WireGuard client that
exposes a SOCKS5 port, which suits webveil's design (a local `127.0.0.1` listener,
webveil-only scope, no system-wide tunnel). **You do not need the Proton app or CLI
running:** wireproxy speaks the WireGuard protocol itself in userspace, so the `.conf`'s
keys + endpoint are all it needs to establish the tunnel (no `wg`/`wg-quick`, no network
interface, no root). Proton's dashboard is just where you generate the config once. (One
limit: wireproxy proxies TCP via SOCKS5 CONNECT, which is all webveil needs; it is not a
UDP path.)

1. Download a **WireGuard config** from Proton's account dashboard (Downloads → WireGuard
   configuration).
2. Add a `[Socks5]` block and run wireproxy:
   ```ini
   # proton.conf (from Proton's WireGuard download, plus the [Socks5] block)
   [Interface]
   PrivateKey = <from Proton>
   Address = 10.2.0.2/32
   DNS = 10.2.0.1

   [Peer]
   PublicKey = <from Proton>
   Endpoint = <proton-server>:51820
   AllowedIPs = 0.0.0.0/0

   [Socks5]
   BindAddress = 127.0.0.1:1080
   ```
   ```sh
   wireproxy -c proton.conf
   ```
3. Point the SOCKS5 endpoint (`socks5://127.0.0.1:1080`) at the **hop that reaches the
   public web** (see the warning above):
   - **Remote backend, or `web_fetch`** → webveil's egress:
     ```sh
     export WEBVEIL_EGRESS=socks5
     export WEBVEIL_EGRESS_URL=socks5://127.0.0.1:1080
     ```
   - **Local SearXNG** → SearXNG's own outbound, in its `settings.yml` (keep webveil
     `direct`):
     ```yaml
     outgoing:
       proxies:
         all://:
           - socks5://127.0.0.1:1080
     ```
     This routes SearXNG's engine requests (→ Google/Bing/…) through Proton; webveil's
     local hop to SearXNG stays direct. (`WEBVEIL_EGRESS=socks5` with a local `baseUrl` is
     rejected, so this is the only correct shape for local SearXNG.)

Because wireproxy is userspace, only the traffic you point at it exits via Proton; your
`git push`, shell, and OS stay on your real IP, with no system tunnel. A ready-made Docker
wrapper that does the same (Proton WireGuard creds in, SOCKS5 on `1080` out) is
[`SamuelMoraesF/protonvpn-proxy`](https://github.com/SamuelMoraesF/protonvpn-proxy). Verify
the proxy with `curl https://ipv4.am.i.mullvad.net --socks5-hostname 127.0.0.1:1080` (a
Proton exit IP means traffic through it exits via Proton); webveil **fails loud** if a
configured proxy is unbuildable, so it never silently falls back to your real IP.

> **Caveat:** webveil's `socks5` mode is NOT a whole-machine VPN. Do not assume enabling it
> anonymizes anything other than webveil. Conversely, a system-wide full-tunnel VPN under
> your logged-in identity is the thing that CAN deanonymize a `git push`; webveil's scoped
> egress deliberately avoids that.

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
| src/core/config.ts                 |  128 |    ~80 |
| src/core/egress.ts                 |  106 |    ~70 |
| src/core/http.ts                   |   62 |    ~60 |
| src/core/extract.ts                |   82 |    ~60 |
| src/core/security.ts (SSRF guard)  |  141 |      - |
| src/core/backends/types.ts         |   61 |    ~40 |
| src/core/backends/registry.ts      |   41 |    ~60 |
| src/core/backends/searxng.ts       |   70 |    ~90 |
| src/core/backends/tavily-compat.ts |  156 |    ~90 |
| src/core/backends/custom.ts        |  159 |    ~70 |
| **subtotal**                       | 1430 |        |

### `packages/pi-webveil` (pi extension frontend)

| module       | LOC | target |
| ------------ | --: | -----: |
| src/index.ts | 168 |    ~90 |

**Total own source: 1598 LOC** (excluding deps).

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
