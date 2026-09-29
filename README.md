<div align="center">
<a href="https://github.com/wighawag/webveil"><img alt="webveil - account-free web search + fetch" src="https://raw.githubusercontent.com/wighawag/webveil/main/media/preview.png" width="640" /></a>
</div>

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

webveil needs a **backend** for results. Two backends give real web results with no account and no API key:

- **`serpcast`**: webveil queries search engines itself, over HTTP with a real browser's fingerprint, following **recipes** you provide. There is no service to run, and webveil's `egress` is the search egress. See [Without SearXNG](#without-searxng-the-serpcast-backend).
- **`searxng`** (the zero-config default): a SearXNG metasearch service you run yourself. See [With a local SearXNG](#with-a-local-searxng-the-default-backend).

No option is zero-setup, account-free and real-web-results at once (see [`work/notes/ideas/default-backend-policy-account-vs-origin.md`](work/notes/ideas/default-backend-policy-account-vs-origin.md)): serpcast needs recipes and a native library, SearXNG needs a service you run, and `tavily-compat` needs an account or a key.

### Without SearXNG: the serpcast backend

Requires Node 22 or later. The prebuilt native library covers Linux x64 and arm64 (glibc), macOS x64 and arm64, and Windows x64; elsewhere, use your own build (step 2).

1. **Install webveil.** It brings the [`serpcast`](https://github.com/wighawag/serpcast) library with it.

   ```sh
   npm install -g webveil
   ```

2. **Install libcurl-impersonate**, the native library every engine request goes through, so that the TLS and HTTP/2 fingerprint are Chrome's. This downloads the pinned release, verifies its sha256 and puts it in `~/.local/share/serpcast/` (`$XDG_DATA_HOME/serpcast/`), where it is found with no configuration. It is the only download, and it happens only when you run it.

   ```sh
   npx serpcast install-libcurl   # add --proxy socks5h://127.0.0.1:9050 to download through a proxy
   npx serpcast doctor            # should end with: impersonation: active (chrome146)
   ```

   Already have libcurl-impersonate 2.1.1 or later (Nix, a distro package, the one your SearXNG uses)? Skip the install and point webveil at it: `"serpcast": {"libcurlPath": "/path/to/libcurl-impersonate.so"}` in the global config, or `WEBVEIL_SERPCAST_LIBCURL_PATH`. webveil loads that library, so a project `webveil.json` cannot set it (see [What a project config can and cannot do](#how-it-works-seams)).

3. **Drop a recipe in a recipes directory.** A recipe is a JSON file that says how to query one engine and read its results page: the URL, and CSS selectors for the results, for "no results" and for a challenge page. webveil and serpcast ship no recipe for a real site: write one for an engine whose terms allow automated access (the format is documented in [`serpcast-recipe`](https://github.com/wighawag/serpcast/tree/main/packages/serpcast-recipe)). For example `~/.config/webveil/recipes/web.json`:

   ```json
   {
   	"name": "web",
   	"navigate": {"url": "https://search.example/?q={query}"},
   	"ready": "article.result a.title",
   	"empty": ".no-results",
   	"blocked": ["#captcha"],
   	"results": {
   		"item": "article.result",
   		"fields": {
   			"title": {"selector": "a.title"},
   			"url": {"selector": "a.title", "attr": "href"},
   			"content": {"selector": ".snippet"}
   		}
   	}
   }
   ```

   **Keep recipes in a directory of their own.** Every `*.json` file in a recipes directory is loaded as a recipe, so any other JSON file there (for example a `webveil.json`, via `"recipes": ["."]`) fails every search with a recipe error naming that file. Try a recipe on its own with `npx serpcast query --recipe ~/.config/webveil/recipes/web.json "hello world"`.

4. **Select the backend** in the global config, `~/.config/webveil/config.json`:

   ```json
   {
   	"backend": "serpcast",
   	"serpcast": {"recipes": ["recipes"], "engines": ["web"]}
   }
   ```

   `recipes` lists recipe files or directories; a relative path is relative to the config file that sets it, never to the cwd. `engines` is the **engine chain**: recipe names, tried in order, and the first engine that answers wins. There is no default chain: a missing or empty `engines` is an error, and so is a name that no loaded recipe has. (Instead of the `backend` key, `WEBVEIL_BACKEND=serpcast` works too.)

5. **Search.**

   ```sh
   webveil search "hello world"
   ```

What to expect:

- **A failing engine hands over to the next one.** An engine that is blocked, times out, or returns a page that no longer fits its recipe is skipped for the next engine in the chain, and the results then carry `unresponsiveEngines`, naming the engines that failed first, so a fallback answer never passes for the first choice. An engine that answered `blocked` cools down: it is skipped for `serpcast.cooldownMs` (default 5 minutes).
- **Decoy guard (for Bing and the like).** Some engines, Bing above all, answer many queries (about half of realistic ones, measured in September 2026) with a well-formed page of results unrelated to the query: a **decoy**. serpcast checks the answers of a guarded engine: a page where at most one of the top 5 results mentions two of the query's content words counts as a decoy, which fails that engine (named in `unresponsiveEngines`, and listed as `decoy` if every engine fails) and hands over to the next one, with no cooldown. An engine is guarded when its recipe declares `"decoyProne": true` (the recipe's author knows the site serves decoys, so nothing is needed in your config), or when you list it in `serpcast.decoyGuard` (for example `"decoyGuard": ["bing"]`, any config layer, or `WEBVEIL_SERPCAST_DECOY_GUARD=bing`, comma-separated). `decoyGuard` is therefore only needed for a recipe that does not declare it; it adds to the recipes' own declarations and cannot switch a declared one off. An engine that is neither is never judged. The rule is serpcast's `isDecoy`: see [serpcast's decoy guard](https://github.com/wighawag/serpcast#decoy-guard).
- **Every engine failed: an error, never an empty list.** The error lists each engine's failure. An empty result list means an engine's `empty` selector matched: the engine really found nothing.
- **No fingerprint, no search.** Impersonation is always strict: if libcurl-impersonate is missing or not the right library, webveil refuses to search and says how to fix it. It never sends a request with a non-browser fingerprint.
- **Sessions persist.** Engine cookies (such as a challenge clearance) and cooldowns are kept between calls in `~/.local/state/webveil/`, one directory per identity (egress plus serpcast settings), and expire after `serpcast.sessionIdleMs` (default 10 minutes) of disuse. `webveil state clear` drops the current identity's state, `--all` every identity's. See *serpcast state on disk* under [How it works](#how-it-works-seams).
- **Anonymity.** With this backend `egress` governs the requests that reach the search engines: see [Where does anonymity live?](#where-does-anonymity-live-read-before-turning-on-egress).
- **`web_fetch` gets the browser fingerprint too.** With this backend `fetchTransport` defaults to `serpcast`, so `web_fetch` also goes through libcurl-impersonate (and so also needs it). Set `"fetchTransport": "plain"` to keep the plain Node transport: see [The `web_fetch` transport](#the-web_fetch-transport-fetchtransport).

**Private recipes** (code recipes, or recipes you would rather not publish) go outside any repository, for example in `~/.config/webveil/recipes/`, named from the global config: see *Private serpcast recipes* under [How it works](#how-it-works-seams). serpcast's [`examples/recipes/marginalia.mjs`](https://github.com/wighawag/serpcast/tree/main/examples/recipes) is such a code recipe, so it goes under `serpcast.codeRecipes` in the global config; its shared `public` key is often rate limited or unresponsive (it timed out for most test queries on 2026-09-29, direct and through Tor), so ask Marginalia for a free personal key and set `MARGINALIA_API_KEY`.

#### Installing recipes

A recipe repository can publish its recipes as one release archive (a `.tar.gz` of `*.json` and `*.mjs` files, optionally with a `manifest.json` naming the set). serpcast installs it, only when you type the command:

```sh
npx serpcast install-recipes https://example.com/my-set-1.2.0.tar.gz --sha256 <hex>   # add --proxy socks5h://127.0.0.1:9050 to download through a proxy
npx serpcast recipes list   # the installed sets, their source, sha256 and files
```

- **Why the pin is required.** A set may hold code recipes, which are code with full Node access, so `--sha256` (the archive's checksum, required for a URL and a local file alike) is your trust decision: exactly these bytes, which you reviewed or whose publisher you trust. Get it from the publisher through a channel you trust, or compute it yourself (`sha256sum my-set-1.2.0.tar.gz`) after reviewing the archive. It is checked before anything is unpacked.
- **Where it goes.** The set is written to `~/.local/share/serpcast/recipes/<set>/` (`$XDG_DATA_HOME/serpcast/recipes/<set>/`), named after `--name` or the archive's `manifest.json`, with a `.source.json` recording where it came from. An identical set already there is left alone; a different one is replaced only with `--force`.
- **A private GitHub release asset** needs authentication, which `install-recipes` does not do. Download it with the GitHub CLI first, then install the file: `gh release download v1.2.0 --repo owner/recipes --pattern 'my-set-1.2.0.tar.gz'`, then `npx serpcast install-recipes ./my-set-1.2.0.tar.gz --sha256 <hex>`.

Point webveil at an installed set with `set:<name>` in `serpcast.recipes` (its declarative recipes) and `serpcast.codeRecipes` (its code recipes), in the global config:

```json
{
	"backend": "serpcast",
	"serpcast": {
		"recipes": ["set:my-set"],
		"codeRecipes": ["set:my-set"],
		"engines": ["api", "web"]
	}
}
```

`set:my-set` is the whole set: every `*.json` file except its `manifest.json` for `recipes`, every `*.js` and `*.mjs` file for `codeRecipes`. `set:my-set/api.mjs` names one file, for a set that also holds helper modules that are not engines. The set is looked up in serpcast's recipes directory (following `XDG_DATA_HOME` in webveil's environment), never in the cwd; a set that is not installed is an error saying how to install it. `codeRecipes` stays a global-config-or-env setting whatever its form (`WEBVEIL_SERPCAST_CODE_RECIPES=set:my-set` works too): a project `webveil.json` naming `set:...` there is refused like any other code recipe path. The plain path (`~/.local/share/serpcast/recipes/my-set`) works as well, but ignores `XDG_DATA_HOME`.

#### A browser engine as the fallback (searchcast)

A **browser engine** runs a declarative recipe in [searchcast](https://github.com/wighawag/searchcast), a real browser, so it has a real browser's fingerprint and runs the page's JavaScript. It is the heaviest engine, so it usually goes last in the chain, to answer when the HTTP engines are blocked. Name it `searchcast:<recipe>` in `serpcast.engines`, so one chain mixes HTTP and browser engines and one recipe file can run both ways:

```json
{
	"backend": "serpcast",
	"serpcast": {
		"recipes": ["recipes"],
		"engines": ["web", "searchcast:web"],
		"searchcast": {"mode": "library", "xvfb": "/usr/bin/Xvfb"}
	}
}
```

`serpcast.searchcast.mode` says how webveil reaches the browser:

- **`library`** (the default): webveil starts searchcast in-process, with `egress` as the browser's proxy. The recipe must be a loaded declarative recipe (a code recipe cannot run in a browser). searchcast is not installed with webveil: install it next to webveil (`npm install -g searchcast` for a global webveil), with a Chromium or Chrome executable, found by searchcast (`$SEARCHCAST_CHROME`, then `PATH`) or set as `serpcast.searchcast.chrome`. Optional keys: `xvfb` (an Xvfb executable: the browser then runs headful on a private virtual display), `chromeArgs` (extra Chromium arguments) and `persistProfile` (`true` keeps the browser profile, its cookies included, in the identity's state directory, deleted once idle past `sessionIdleMs`; the default is a temporary profile per process). `chrome`, `xvfb` and `chromeArgs` make webveil run a program, so they are accepted only from the global config or env (`WEBVEIL_SERPCAST_SEARCHCAST_CHROME`, `WEBVEIL_SERPCAST_SEARCHCAST_XVFB`, and `WEBVEIL_SERPCAST_SEARCHCAST_CHROME_ARGS`, split on whitespace), and a Chromium argument that sets the browser's proxy or host resolution is refused (see [What a project config can and cannot do](#how-it-works-seams)).
- **`endpoint`**: a `searchcast serve` you run yourself, `"searchcast": {"mode": "endpoint", "endpoint": "/run/searchcast/searchcast.sock"}` (a Unix socket path or an `http://` URL); `<recipe>` is then the recipe's name on that server and is not loaded locally. webveil does not run that browser, so it cannot put it on its egress: endpoint mode requires `egress: direct` (see [Where does anonymity live?](#where-does-anonymity-live-read-before-turning-on-egress)).

Two limits of library mode. A persistent profile (`persistProfile`) must not be used by two webveil processes of the same identity at once (two parallel CLI calls, or the CLI next to a running MCP server or pi extension): Chromium's profile lock refuses the second browser. And searchcast is resolved from webveil's own install location, so it must be installed alongside webveil: webveil declares it as an optional peer dependency (`searchcast >=0.1.1`), so a package manager does not install it for you but, once you install it next to webveil (in the same project, or globally next to a global webveil), exposes it to webveil even under a strict pnpm layout. Without it a library-mode engine fails before any search with an error saying to install it.

#### On NixOS

Everything below runs webveil's serpcast backend on NixOS without anything else. Verified on 2026-09-29 (NixOS, Node 24.19.0, webveil 0.5.0, serpcast 0.1.1), except where a point says otherwise.

- **libcurl-impersonate.** `npx serpcast install-libcurl` works: the prebuilt linux-x64 library needs only libc and uses NixOS's CA bundle at `/etc/ssl/certs/ca-certificates.crt`. nixpkgs' `curl-impersonate` works too (the same pinned 2.1.1 release, identical JA4 and HTTP/2 fingerprint). Do not put a `/nix/store/...` path in a config file (it breaks after an upgrade or garbage collection): link the library where serpcast looks by default instead, for example with home-manager `xdg.dataFile."serpcast/libcurl-impersonate.so".source = "${pkgs.curl-impersonate}/lib/libcurl-impersonate.so";`, or set `WEBVEIL_SERPCAST_LIBCURL_PATH` in a dev shell. Check with `npx serpcast doctor`.
- **Recipes.** `npx serpcast install-recipes <archive> --sha256 <hex>` works as is on NixOS, into `~/.local/share/serpcast/recipes/<set>/` (see [Installing recipes](#installing-recipes)). For a declarative setup, home-manager can place a pinned, unpacked archive there instead, which webveil reads the same way (`set:<name>`):

  ```nix
  # a public archive: fetchzip pins the UNPACKED content (a Nix hash, not the archive's sha256)
  xdg.dataFile."serpcast/recipes/my-set".source = pkgs.fetchzip {
    url = "https://example.com/my-set-1.2.0.tar.gz";
    hash = "sha256-..."; # leave empty once; Nix prints the right one
    # stripRoot = false; # when the files sit at the archive's root, not under one directory
  };
  # a private archive (downloaded with gh, see above): a local, already unpacked directory
  # xdg.dataFile."serpcast/recipes/my-set".source = ./recipes/my-set;
  ```

  The `fetchzip` form was built with Nix 2.34.8 and nixpkgs 26.11 on 2026-09-29 (a set under one top directory with the default `stripRoot`, and a root-level set with `stripRoot = false`; a root-level set with the default fails with "zip file must contain a single file or directory"). The `xdg.dataFile` line is home-manager's documented option shape, not run here. A set placed this way has no `.source.json`, so `serpcast recipes list` shows no source for it; webveil loads it anyway.
- **Where the global config lives.** `~/.config/webveil/config.json` (`$XDG_CONFIG_HOME/webveil/config.json`), as on any Linux. With home-manager, write it from Nix: `xdg.configFile."webveil/config.json".text = builtins.toJSON { ... };` (the file is then a read-only link into the store; edit the Nix expression instead).
- **A complete minimal config**: the serpcast backend over Tor, recipes from an installed set, and `web_fetch` over serpcast too:

  ```nix
  services.tor.client.enable = true; # NixOS: SOCKS on 127.0.0.1:9050
  # home-manager:
  xdg.configFile."webveil/config.json".text = builtins.toJSON {
    backend = "serpcast";
    egress = { mode = "socks5"; url = "socks5://127.0.0.1:9050"; };
    fetchTransport = "serpcast"; # the default with this backend; stated for clarity
    serpcast = {
      recipes = [ "set:my-set" ];
      codeRecipes = [ "set:my-set" ];
      engines = [ "api" "web" ]; # recipe names from the set, in order
    };
  };
  xdg.dataFile."serpcast/libcurl-impersonate.so".source = "${pkgs.curl-impersonate}/lib/libcurl-impersonate.so";
  ```

  The `builtins.toJSON` expression was evaluated with `nix eval` (it gives `{"backend":"serpcast","egress":{"mode":"socks5","url":"socks5://127.0.0.1:9050"},"fetchTransport":"serpcast","serpcast":{"codeRecipes":["set:my-set"],"engines":["api","web"],"recipes":["set:my-set"]}}`), and webveil's tests load an installed set through `set:<name>`; the whole block was not applied with home-manager here. Replace `my-set`, `api` and `web` with your set and its recipe names, then check with `npx serpcast doctor` and `webveil search "hello world"`.
- **npm's allow-scripts warning for `koffi`** (npm 11 blocks its install script) is harmless: koffi's prebuilt binary loads without it.
- **Browser engines (library mode).** Set `serpcast.searchcast.chrome` to nixpkgs Chromium (`${pkgs.chromium}/bin/chromium`, or `/run/current-system/sw/bin/chromium` when installed system-wide); browsers downloaded by other tools (such as Playwright's) run only with `programs.nix-ld` enabled. Without a display (a server, an SSH session) set `serpcast.searchcast.xvfb` to nixpkgs' Xvfb (`${pkgs.xvfb}/bin/Xvfb`, `pkgs.xorg.xvfb` on older nixpkgs), or pass `"chromeArgs": ["--headless=new"]` (easier for sites to detect). Both verified.
- **Tor.** `services.tor.client.enable = true;` gives a SOCKS proxy on `127.0.0.1:9050`: use `"egress": {"mode": "socks5", "url": "socks5://127.0.0.1:9050"}` (webveil hands serpcast `socks5h`, so DNS stays at Tor). Search and `web_fetch` (both transports) exit through Tor (`check.torproject.org/api/ip` reports `IsTor: true`) with the same fingerprint as direct.

### With a local SearXNG (the default backend)

The zero-config default is a local **SearXNG** at `http://127.0.0.1:8080` on `direct` egress (non-anonymous). Run one with Docker:

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

**The serpcast backend has no such split: the search hop is webveil's own.** webveil itself sends every engine request (declarative recipes, code recipes, and the library-mode searchcast browser, which gets `egress` as its proxy), so `egress` governs exactly the traffic that reaches the search engines, and `egress: socks5` really anonymizes search. A SOCKS proxy is always handed over as `socks5h`, so host names are resolved at the proxy. The loopback guard above does not apply (serpcast has no `baseUrl` hop); it concerns SearXNG. serpcast has one case of the same trap, and webveil refuses it the same way:

- **An external searchcast endpoint** (`serpcast.searchcast.mode: "endpoint"`) is a browser webveil does not run, so it reaches the engines from wherever it runs, outside webveil's egress. With a non-`direct` egress and a `searchcast:` engine in the chain, webveil refuses to search. Use library mode, or `egress: direct` with the searchcast server proxied by other means (anonctl, below).
- Also refused, with a library-mode browser engine: a SOCKS `egress` URL with credentials. Chromium has no SOCKS authentication, so the credentials (and any Tor circuit isolation they select) would be silently dropped.

**Under [anonctl](https://github.com/wighawag/anonctl)** (every connection of one Unix account forced through an anonymizer such as Tor by the kernel, fail-closed), run webveil as that account with `egress: direct`, the default. serpcast's engine requests, the library-mode browser and `web_fetch` all leave through the forced tunnel with no further configuration, and endpoint mode is allowed too (`direct`), provided the searchcast server runs under the forced account as well.

webveil splits egress into **two independent hops** so you can set them differently (see
[Per-hop egress](#per-hop-egress-local-searxng--proxied-web_fetch) below):

- **`egress`** governs the BACKEND hop (webveil -> backend `baseUrl`).
- **`fetchEgress`** governs the `web_fetch` hop (webveil -> arbitrary URL). It DEFAULTS
  to inheriting `egress` when unset, so a single `egress` still drives both hops exactly
  as before.

So the correct setups:

| Goal | backend hop (`egress`) | `web_fetch` hop (`fetchEgress`) | backend | Who anonymizes the web hop |
| --- | --- | --- | --- | --- |
| Local SearXNG, anonymous searches | `direct` | `direct` | local SearXNG | **SearXNG itself**, set its `outgoing.proxies` (Tor/SOCKS) in `settings.yml` |
| **Local SearXNG + anonymous `web_fetch`** (the common one) | `direct` | `socks5` | local SearXNG | SearXNG's `outgoing.proxies` for SEARCH; webveil's hop for FETCH |
| Remote SearXNG, hide your IP from it | `socks5` | (inherits) | the **remote** SearXNG url | webveil's hop (Mullvad/Tor) |
| Anonymous `web_fetch` of arbitrary URLs | `direct`/(any) | `socks5` | (any) | webveil's hop |
| Non-anonymous everyday use | `direct` | `direct` | local SearXNG | nobody (honest) |
| **serpcast, anonymous searches** (no SearXNG) | `socks5` | (inherits) | `serpcast` | webveil's hop, for SEARCH and FETCH |
| serpcast under anonctl | `direct` | `direct` | `serpcast` | anonctl (the whole account is forced) |
| serpcast, non-anonymous | `direct` | `direct` | `serpcast` | nobody (honest) |

Rule of thumb: **proxy the hop that actually reaches the public internet.** For SEARCH
via a self-hosted SearXNG that hop is SearXNG's, so the search proxy goes on SearXNG
(`outgoing.proxies`) and webveil's backend hop stays `direct`. For `web_fetch` the public
hop is webveil's own, so `fetchEgress: socks5` is correct even while the backend stays
local. webveil's backend `socks5` mode is for *remote* backends. See
[`work/notes/findings/webveil-anonymity-boundary.md`](work/notes/findings/webveil-anonymity-boundary.md)
and [`docs/adr/0003`](docs/adr/0003-per-hop-egress-backend-vs-fetch.md).

With the serpcast backend the hop that reaches the public internet for SEARCH is webveil's own, so the search proxy goes on `egress`, and `fetchEgress` inherits it unless you set it. See [`docs/adr/0004`](docs/adr/0004-engine-layer-in-serpcast-webveil-injects-policy.md).

### The `web_fetch` transport (`fetchTransport`)

`web_fetch` downloads the page itself (distilly then turns it into markdown), and `fetchTransport` says how:

| key | values | default | env |
| --- | --- | --- | --- |
| `fetchTransport` | `plain`: undici over the fetch-hop egress, a Node TLS fingerprint. `serpcast`: serpcast's libcurl-impersonate transport, Chrome's TLS and HTTP/2 fingerprint and the header set of a Chrome page load | `serpcast` when `backend` is `serpcast`, `plain` otherwise | `WEBVEIL_FETCH_TRANSPORT` |

An explicit value (from any config file or env) always wins over the default, so `"fetchTransport": "serpcast"` works with SearXNG too, and `"plain"` keeps the Node transport with the serpcast backend. Any other value is an error. Sites that gate on the TLS fingerprint answer a Node fetch with a block or challenge page; `serpcast` gets the page a browser would, as long as the page does not need JavaScript (no script runs).

With `serpcast`:

- **Same egress.** Requests leave through the fetch-hop egress (`fetchEgress`, else `egress`), mapped as for the serpcast backend: `direct` is a direct connection, an `http` proxy is used as is, and a SOCKS proxy is always used as `socks5h` (host names resolved at the proxy).
- **Same SSRF guard, on every hop.** The transport follows no redirects, so webveil follows them (at most 20, http and https only) and checks each target before sending it: on `direct` egress a redirect to a private or loopback address is refused.
- **No fingerprint, no fetch.** Impersonation is strict, as for search: without libcurl-impersonate `web_fetch` fails with the fix in the error (`npx serpcast install-libcurl`, or `serpcast.libcurlPath`). It never falls back to `plain`. The library path is the same `serpcast.libcurlPath`, with the same trust rule (never from a project `webveil.json`); `serpcast.engines` is not needed.
- **No cookies between fetches.** Each fetch starts with an empty cookie jar: cookies set during one fetch's redirects are sent on its later hops, then dropped. Nothing is written to the serpcast state directory: a fetch is not a search identity, and cookies carried from page to page would link the fetches.
- **Connections are reused between fetches (of the same egress).** A new TCP + TLS setup per fetch costs about 0.5 s over Tor, a reused connection about 0.09 s, so webveil keeps a small pool of serpcast sessions per fetch-hop egress: a fetch takes an idle one (its cookies cleared), uses it alone, and returns it. Concurrent fetches get different sessions, a different egress never shares one, and an idle session is closed after 10 minutes (serpcast's session idle default) or when webveil exits. The trade-off: a site sees repeated fetches to it arrive on one TLS connection, which links them at the connection level. Through one proxy or Tor circuit they already share an exit IP, and no cookie or other state is carried from one fetch to the next.
- GET only, and only the Chrome page-load headers are sent. The time limit (15 s) and the largest body (16 MiB) are serpcast's defaults; exceeding either is an error.

A backend with its own `/extract` (`tavily-compat`) still fetches through that endpoint whatever `fetchTransport` says.

### Chained egress: Mullvad base → rotating-residential exit → site

For the strongest anonymity stack, a single commercial proxy is a single point of legal
exposure: a rotating-residential provider is an adversary that knows **who paid** (and
sees the traffic), while Mullvad sees the traffic but is deliberately decoupled from your
identity. Chain them so neither adversary sees both ends:

**app → Mullvad (WireGuard base) → rotating-residential exit → site**

The whole chain can live inside ONE local SOCKS5 listener (e.g. a sing-box unit whose
SOCKS inbound detours through its WireGuard outbound: SOCKS → Mullvad → residential
exit), so the chain looks like any other SOCKS endpoint. **webveil's own hops are
unchanged by this** — a chain is just another SOCKS5 listener to webveil, it needs no
special mode:

- **`fetchEgress` points at the chain's port like any `socks5h://` URL**
  (`socks5h://127.0.0.1:1080`), exactly like the single-proxy examples above.
- **A local SearXNG backend hop stays `direct`** exactly as in the table above (the
  backend-hop guard still rejects proxying it); SearXNG carries its own engine crawl
  through the same chain via its `outgoing.proxies`.

**Tor cannot be a chain base.** Tor's exit path is fixed to Tor relays — there is no
"Tor exits into a paid SOCKS" direction — so Tor can carry the whole path or nothing. A
chain that needs a controlled exit identity starts from a WireGuard base (Mullvad), not
Tor.

A chain (or any egress rotation) is also the repair when engines flag your direct IP and
serve irrelevant-but-confident results — that fix lives in SearXNG's `outgoing.proxies`,
never in webveil: see
[Troubleshooting: irrelevant-but-confident results](docs/searxng-setup.md#troubleshooting-irrelevant-but-confident-results-flagged-egress-ip).

## How it works (seams)

- **core**, the framework-agnostic `search(query, opts)` and `fetch(url, opts)` functions.
  Both frontends call the same core.
- **backend seam**, where results/content come from: `searxng` (keyless self-hosted
  metasearch), `tavily-compat` (a generic Tavily-shaped `/search` + `/extract`),
  `custom` (a local command via a JSON stdin/stdout contract), and `serpcast` (keyless
  search engines from recipes over libcurl-impersonate, no SearXNG; webveil's `egress`
  is its search egress). The backend is handed a
  proxied `http` helper so it cannot bypass egress. The searxng backend also surfaces
  engine degradation from the response's `unresponsive_engines` — partial failures
  **annotate** the results (`unresponsiveEngines`, so a degraded answer never masquerades
  as a clean one), a probable full outage **fails loud**. Honest limit: it cannot detect
  junk results — a 200 "decoy SERP" parses like a real one at this layer — see
  [SearXNG troubleshooting](docs/searxng-setup.md#troubleshooting-irrelevant-but-confident-results-flagged-egress-ip).
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
  - **Merge rule.** Layers merge key by key, and so do config sections (plain objects): a project `webveil.json` that sets one key of a section keeps the global config's other keys in that section. Scalars and arrays are replaced whole by the highest layer that sets them. `egress` and `fetchEgress` are also replaced whole (a project `{"mode": "direct"}` over a global SOCKS5 egress is exactly `direct`, never `direct` plus a stray url).
  - **What a project config can and cannot do.** A `webveil.json` is read automatically from any checkout you run webveil in, so a cloned repository must never be able to make webveil run code. A project config may choose the backend, its URL, egress, fetch size and other plain settings, but a setting that makes webveil run code (today: the `custom` backend's command, i.e. its `baseUrl` when `backend` is `custom`, the serpcast backend's `serpcast.libcurlPath`, a native library webveil loads, its `serpcast.codeRecipes`, JS modules webveil imports and so runs, and the searchcast browser's `serpcast.searchcast.chrome`, `serpcast.searchcast.xvfb` and `serpcast.searchcast.chromeArgs`, programs and arguments webveil launches) is refused when it comes from a project `webveil.json`, with an error naming the file and the key: put it in the global config or env instead. Even from a trusted layer, a searchcast chrome argument that controls the browser's proxy or host resolution (`--proxy-server`, `--no-proxy-server`, `--proxy-bypass-list`, `--proxy-pac-url`, `--proxy-auto-detect`, `--winhttp-proxy-resolver`, `--host-resolver-rules`, `--host-rules`, in any case, with one or two dashes) is refused with an error naming it: the browser's proxy comes from `egress`, and such an argument would silently take the browser off it. A project may still say `"backend": "custom"` when the command itself comes from the global config or env. The check runs only where the setting is used, so `web_fetch` keeps working in such a folder. Paths in executable settings never resolve against the cwd: `~/` is your home directory, a relative path is relative to the config file that set it, a value from env must be absolute or `~/`-prefixed, and a bare command name (no slash; on Windows, no `/`, no `\` and no drive prefix like `C:`) is looked up on `PATH` by webveil itself, searching only absolute `PATH` entries: empty, `.` and other relative entries are ignored, so a file in the cwd is never picked up, and a name found in no absolute entry is an error before anything runs. On Windows, only a drive path (`C:\...`) or a UNC path (`\\server\share\...`) counts as absolute; `\tools\x.exe` is relative to the config file (so it takes that file's drive), and a drive-relative `C:x.exe` is refused. See [`docs/adr/0004`](docs/adr/0004-engine-layer-in-serpcast-webveil-injects-policy.md).
  - **Private serpcast recipes.** A code recipe (a JS module for an engine that needs challenge handling, or a site whose terms you would rather not publish in a repo) is code with full Node access, and loading it runs it. Keep such recipes outside any repository, for example in `~/.config/webveil/recipes/`, and list them in the global config as `"serpcast": {"codeRecipes": ["recipes"]}` (a module file, or a directory whose `*.js` and `*.mjs` files are all loaded; a relative path is relative to the global config file), or in env as `WEBVEIL_SERPCAST_CODE_RECIPES` (absolute or `~/` paths, separated by `:`, or `;` on Windows). A set installed with `serpcast install-recipes` is named `set:<name>` (or `set:<name>/<file>`) in either form: see [Installing recipes](#installing-recipes). A project `webveil.json` cannot name them: it is read automatically from any checkout, so a cloned repository could otherwise make webveil import its own module. The project config may still list those recipes in its `serpcast.engines` order, because `serpcast` merges key by key and keeps the global `codeRecipes`. Code and declarative recipes share one name space; a name used twice is an error.
  - **serpcast state on disk, per identity.** The serpcast backend keeps its sessions (an engine's cookies, such as a challenge clearance, and a code recipe's own JSON state) and its engine cooldowns in `$XDG_STATE_HOME/webveil/` (default `~/.local/state/webveil/`), so the one-shot CLI behaves like the long-lived MCP server and pi extension. Nothing else is stored (no queries, no results), except the searchcast browser profile when you opt into `serpcast.searchcast.persistProfile`: it lives in the identity's directory as `<hash>/browser-profile`, holds that browser's own cookies and history, and is deleted before the next use once the identity has been idle past `serpcast.sessionIdleMs`. State is partitioned per **identity**, the backend-hop `egress` plus the resolved `serpcast` section, hashed: each identity gets its own directory `<hash>/state.json`, so no proxy URL, credential or path appears in a file name, and a session obtained on one egress is never replayed on another (which would link the two). A session keeps its idle expiry (`serpcast.sessionIdleMs`, default 10 minutes) on disk: it is checked on every read and an expired entry is dropped, so saving state never lets cookies link searches across days. Concurrent `webveil search` calls share the file safely (a lock file around each update, writes replaced atomically). Files are `0600`, directories `0700`. Clear it with `webveil state clear` (the identity of the current folder's config) or `webveil state clear --all` (every identity); deleting the directory by hand is also fine.
- **extractor seam**, `urlToMarkdown` via `distilly/fetch` by default, injected with
  webveil's egress-bound `fetch`; a backend's own `/extract` (Tavily-compat) may override
  it. Owns the context-friendly markdown + size presets (`s`/`m`/`l`/`f`). See
  [`docs/adr/0001`](docs/adr/0001-extractor-uses-distilly-fetch-with-injected-egress.md).
  The injected `fetch` is the plain egress fetch, or with `fetchTransport: serpcast`
  serpcast's impersonated transport (see [The `web_fetch` transport](#the-web_fetch-transport-fetchtransport)).
- **security**, an SSRF guard lives in the egress fetch, so it covers distilly's
  rule-rewritten requests too. The serpcast fetch transport runs it on every redirect hop.

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

> **`egress: socks5` is for a REMOTE backend, NOT a local SearXNG.** If your `baseUrl` is
> a local SearXNG (`unix:` or loopback like `127.0.0.1` / `localhost`),
> `WEBVEIL_EGRESS=socks5` is **rejected** (fail-loud), because webveil → local-SearXNG is
> a local hop; proxying it would give fake anonymity while SearXNG still crawls the web
> from your real IP. The hop that needs proxying is SearXNG's own, so you put the search
> proxy on **SearXNG** (`outgoing.proxies`) and keep the backend hop `direct`. To proxy
> `web_fetch` while keeping the local backend, set **`fetchEgress`** (the FETCH hop), NOT
> `egress` (see [Per-hop egress](#per-hop-egress-local-searxng--proxied-web_fetch)). See
> [Where does anonymity live?](#where-does-anonymity-live-read-before-turning-on-egress)
> for the full table; the same SOCKS5 listener (Mullvad/Tor/wireproxy below) plugs into
> either side.

With the **serpcast** backend there is no local backend hop to protect: `egress: socks5` is exactly the setting that anonymizes your searches, since webveil itself sends the engine requests.

### Per-hop egress: local SearXNG + proxied `web_fetch`

The most common self-hosted topology is a **local SearXNG** (loopback TCP or a `unix:`
socket) for search, with `web_fetch` of arbitrary URLs going out through a **SOCKS5
proxy** (e.g. wireproxy → ProtonVPN at `socks5h://127.0.0.1:1080`). The two hops are
independent, so set them independently:

- **backend hop** (`egress`): `direct`. The local SearXNG anonymizes its OWN engine
  crawl via `outgoing.proxies` in `settings.yml`.
- **`web_fetch` hop** (`fetchEgress`): `socks5`. The fetch target is a real public URL,
  so proxying it genuinely anonymizes that hop.

Concrete `~/.config/webveil/config.json`:

```json
{
  "baseUrl": "http://127.0.0.1:8080",
  "egress": { "mode": "direct" },
  "fetchEgress": { "mode": "socks5", "url": "socks5h://127.0.0.1:1080" }
}
```

Or a `unix:`-socket SearXNG with the same proxied fetch:

```json
{
  "baseUrl": "unix:/usr/local/searxng/run/socket",
  "fetchEgress": { "mode": "socks5", "url": "socks5h://127.0.0.1:1080" }
}
```

(`egress` omitted defaults to `direct`; `fetchEgress` does NOT inherit it here, it is set
explicitly to `socks5`.) Or via env:

```sh
export WEBVEIL_BASE_URL=http://127.0.0.1:8080   # local SearXNG, backend hop stays direct
export WEBVEIL_FETCH_EGRESS=socks5
export WEBVEIL_FETCH_EGRESS_URL=socks5h://127.0.0.1:1080
```

**Prefer `socks5h://` for the fetch hop** (the `h` means the proxy does DNS resolution):
webveil does not resolve hostnames locally under proxy egress, and `socks5h` makes the
remote-DNS intent explicit so a target hostname is never leaked to your local resolver.
(`fetchEgress` defaults to inheriting `egress` when unset, so existing single-`egress`
configs are completely unchanged. The backend-hop guard still rejects `egress: socks5`
with a local `baseUrl`; it does NOT block this `fetchEgress` setup, because the fetch hop
is a different, genuinely-public hop. See
[`docs/adr/0003`](docs/adr/0003-per-hop-egress-backend-vs-fetch.md).)

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
   - **Remote backend** (search via a remote SearXNG) → webveil's BACKEND egress:
     ```sh
     export WEBVEIL_EGRESS=socks5
     export WEBVEIL_EGRESS_URL=socks5h://127.0.0.1:1080
     ```
   - **`web_fetch`** (arbitrary URLs, with ANY backend incl. a LOCAL SearXNG) → webveil's
     FETCH egress:
     ```sh
     export WEBVEIL_FETCH_EGRESS=socks5
     export WEBVEIL_FETCH_EGRESS_URL=socks5h://127.0.0.1:1080
     ```
     This proxies `web_fetch` while the local-SearXNG backend hop stays `direct` (see
     [Per-hop egress](#per-hop-egress-local-searxng--proxied-web_fetch)).
   - **Local SearXNG SEARCH** → SearXNG's own outbound, in its `settings.yml` (keep the
     backend hop `direct`):
     ```yaml
     outgoing:
       proxies:
         all://:
           - socks5://127.0.0.1:1080
     ```
     This routes SearXNG's engine requests (→ Google/Bing/…) through Proton; webveil's
     local hop to SearXNG stays direct. (`WEBVEIL_EGRESS=socks5` with a local `baseUrl` is
     rejected; proxy SEARCH on SearXNG, and proxy `web_fetch` via `WEBVEIL_FETCH_EGRESS`.)

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
| src/index.ts (barrel)              |  130 |      - |
| src/cli.ts (incur frontend)        |  166 |    ~80 |
| src/core/search.ts                 |  141 |    ~90 |
| src/core/fetch.ts                  |  160 |    ~90 |
| src/core/fetch-transport.ts        |  160 |      - |
| src/core/config.ts                 |  309 |    ~80 |
| src/core/layers.ts (merge + prov.) |  121 |      - |
| src/core/trust.ts (exec. settings) |  166 |      - |
| src/core/identity.ts               |   29 |    ~30 |
| src/core/state.ts (per-id. store)  |  249 |   ~120 |
| src/core/egress.ts                 |  175 |    ~70 |
| src/core/http.ts                   |   62 |    ~60 |
| src/core/extract.ts                |   82 |    ~60 |
| src/core/security.ts (SSRF guard)  |  158 |      - |
| src/core/baseurl.ts (transport)    |  104 |      - |
| src/core/backends/types.ts         |   70 |    ~40 |
| src/core/backends/registry.ts      |   54 |    ~60 |
| src/core/backends/searxng.ts       |  116 |    ~90 |
| src/core/backends/tavily-compat.ts |  156 |    ~90 |
| src/core/backends/custom.ts        |  187 |    ~70 |
| src/core/backends/serpcast.ts      |  600 |    ~90 |
| **subtotal**                       | 3395 |        |

### `packages/pi-webveil` (pi extension frontend)

| module       | LOC | target |
| ------------ | --: | -----: |
| src/index.ts | 183 |    ~90 |

**Total own source: 3578 LOC** (excluding deps).

> Reality vs. target: several modules currently exceed their `CONTEXT.md` ceilings (notably `backends/serpcast.ts`, which also carries the trust, browser and egress-guard policy of that backend, `config.ts`, `tavily-compat.ts`, `custom.ts` and `pi-webveil/src/index.ts`), and six built modules (the `index.ts` barrel, the `security.ts` SSRF guard, the `baseurl.ts` backend transport, `layers.ts` and `trust.ts` behind the trust rule, and `fetch-transport.ts`, the `web_fetch` transport choice and serpcast adapter) have no ceiling of their own. The table above reflects the modules as actually built. For calibration, comparable pi web-search extensions: `pi-searxng-search` 350 LOC (1 backend, no egress, no fetch), `leing2021/pi-search` 1714, `pi-search-hub` 9047, `pi-web-providers` 18961. webveil delivers a 4-backend + egress + fetch + per-folder-config tool by leaning on `incur` (CLI/MCP/skills), `distilly` (extraction) and `serpcast` (the search engines of the `serpcast` backend).

## Develop

```sh
pnpm install
pnpm build
pnpm test
pnpm format:check
```

The `test` workflow (`.github/workflows/test.yml`) runs the same gate on every push to main and every pull request.

## Release

Both packages are released with [changesets](https://github.com/changesets/changesets), each with its own version. A PR that should ship adds a changeset (`pnpm changeset`, pick the packages and the bump). On main, the `release` workflow (`.github/workflows/release.yml`) opens or updates a "Version Packages" PR from the pending changesets; merging it publishes the bumped packages to npm through npm Trusted Publishing (OIDC, no token), with provenance. There is no local publish script: every release goes through that workflow. Both published packages carry this README and the AGPL `LICENSE`, copied in at pack time by `scripts/copy-publish-assets.mjs`.
