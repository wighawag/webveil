# SearXNG setup (detailed)

webveil's zero-config default is a local **SearXNG** at `http://127.0.0.1:8080` on
`direct` egress. The [Quick start](../README.md#quick-start) covers the happy path (Docker,
one port note). This page is the full reference: every install topology, the
uwsgi-vs-`http-socket` catch, Unix sockets, reverse proxies, and the limiter/JSON
requirements.

Full upstream install options (Docker, Compose, script, bare-metal) are in the official
docs at <https://docs.searxng.org/admin/installation.html>. Topology + catches captured in
[`work/notes/findings/searxng-install-topology.md`](../work/notes/findings/searxng-install-topology.md)
and
[`work/notes/findings/searxng-script-socket-is-uwsgi-not-http.md`](../work/notes/findings/searxng-script-socket-is-uwsgi-not-http.md).

## Every install needs: JSON API on, limiter off (for local)

This applies to **every** option below, it is a SearXNG-side requirement, not a webveil
one. A fresh script install ships with `server.limiter: true` and often no `json` output
format, so webveil gets `429 TOO MANY REQUESTS` or an HTML page. In SearXNG's
`settings.yml`:

- set `server.limiter: false`
- set `server.public_instance: false` (safe for a LOCAL, socket-only instance, NOT
  internet-exposed)
- add `json` under `search.formats:` (`[html, json]`)

then restart uWSGI.

## The port gotcha

SearXNG's default port depends on how you install it:

- **Docker** binds **8080** internally regardless (its entrypoint forces `0.0.0.0:8080`).
  webveil's default expects 8080, so Docker matches with no config.
- **Bare-metal / pip / source** defaults to **8888** (`settings.yml` `server.port: 8888`).
- SearXNG's own docs suggest `docker run … -p 8888:8080` (host 8888 → container 8080).

If your instance is on any other port, point webveil at it:

```sh
export WEBVEIL_BASE_URL=http://127.0.0.1:8888   # or wherever your instance listens
```

or set `baseUrl` in `webveil.json`.

## Install topologies

webveil needs something to point `baseUrl` at: an **HTTP `host:port`**, or (script
install) the **Unix socket** itself.

### Docker

Binds a real TCP port directly; simplest if you only need webveil.

```sh
docker run -d --name searxng -p 8080:8080 searxng/searxng
```

### Install script as a background service

`sudo -H ./utils/searxng.sh install all` (see
<https://docs.searxng.org/admin/installation-scripts.html>) sets SearXNG up as a
systemd/uWSGI service.

**Gotcha:** by default this listens on a **Unix socket**
(`socket = /usr/local/searxng/run/socket`), NOT a TCP port. And, crucially, that default
socket speaks the **native uwsgi protocol, NOT HTTP** (`socket = …`, not `http-socket =
…`), so even a `curl --unix-socket … http://localhost/` returns HTTP 000. webveil's
`unix:` baseUrl speaks **HTTP over a unix socket** via undici, so it CANNOT reach that
default uwsgi socket directly. Three ways to reach the install-script instance:

#### Option A: point webveil straight at an HTTP unix socket

No proxy, no extra process, once the socket actually speaks HTTP. The install-script
default does NOT, so first make uWSGI serve HTTP on the socket: in the generated `.ini`,
replace `socket = /usr/local/searxng/run/socket` with
`http-socket = /usr/local/searxng/run/socket` (HTTP over the socket instead of the uwsgi
protocol). THEN point webveil at it with a `unix:` URL naming the socket file:

```sh
export WEBVEIL_BASE_URL=unix:/usr/local/searxng/run/socket
```

webveil dials the socket directly over undici (`Agent({connect:{socketPath}})`, no extra
dependency) and issues its normal `/search?...&format=json` request. The grammar is
`unix:<socketPath>[:<httpPath>]`: the socket file path, then an OPTIONAL `:` + base path
(mount point) the SearXNG app lives under (defaults to `/`, so the example above requests
`/search`; a non-root mount is `unix:/usr/local/searxng/run/socket:/searxng`). (`unix:`
works against ANY HTTP-on-a-unix-socket server, e.g. a Caddy/nginx upstream bound to a
socket; the uwsgi-vs-`http-socket` distinction above is the SearXNG-specific catch.)

**Egress must be `direct`** for this: a Unix socket is inherently local, so combining a
`unix:` baseUrl with `egress=http`/`socks5` fails loud (proxying a local hop is fake
anonymity, see [Where does anonymity
live?](../README.md#where-does-anonymity-live-read-before-turning-on-egress); proxy
SearXNG's `outgoing.proxies` instead and keep webveil `direct`).

#### Option B: front it with a reverse proxy

This is what the SearXNG docs' nginx/apache step is for: it bridges HTTP-on-a-port to the
uWSGI socket, serving BOTH the browser UI and webveil. **Any HTTP server works**, the docs
say so explicitly; **Caddy is fine** and a good pick if you already run it. Plain Caddy
`reverse_proxy` speaks **HTTP** to its upstream, so point it at an `http-socket` (or a TCP
`http-socket`):

```caddy
searxng.example.com {
    reverse_proxy unix//usr/local/searxng/run/socket   # plain reverse_proxy = HTTP, so the socket must be http-socket = (not the uwsgi socket =)
}
```

Then point webveil at the Caddy address. (Set SearXNG's `server.base_url` in `settings.yml`
to match, and keep the limiter in mind, above.) If you want a Caddy frontend AND
webveil-direct, the simplest path is ONE `http-socket` that both consume (Caddy's HTTP
`reverse_proxy` and webveil's `unix:` both speak HTTP to it); you only need the uwsgi
`socket = ` form if Caddy uses an explicit uwsgi transport.

#### Option C: make uWSGI listen on a TCP port

In the generated `.ini`, replace `socket = …/run/socket` with
`http-socket = 127.0.0.1:8888`, then point webveil at `http://127.0.0.1:8888`. Good when
you want ONLY webveil (no public web UI / TLS).

## Troubleshooting: irrelevant-but-confident results (flagged egress IP)

**Symptom signature:** searches come back **confident and irrelevant** — a technical query
returns pizza restaurants, dictionary definitions, or unrelated `.co.uk` pages, ranked as
if they were real hits, with no error anywhere. This is **not a SearXNG bug and not a
webveil bug**: it is the signature of the **engines flagging your instance's egress IP**.
Search engines refuse or poison clients they distrust (shared/dynamic residential IPs get
this treatment), and they do it in two presentations:

1. **Hard-fail** — a 4xx, a CAPTCHA page, or a suspension. SearXNG records these in the
   JSON response's `unresponsive_engines`, so the degradation is visible.
2. **Decoy SERP** — the nastier one: an HTTP **200** page of *unrelated but
   SERP-shaped* results (bing does this, keyed on the client's IP/ISP). SearXNG parses and
   ranks it faithfully, the engine reports no error, and **the response carries no
   degradation signal at all**. The results differ per request and per parameter variant,
   and popular exact phrases ("hello world") still answer correctly — which is why it
   looks like flakiness rather than an outage.

### Isolate it: one engine at a time, then the aggregate

Query a single engine directly and look at what it actually returned (SearXNG's
`engines=<name>` parameter; over a unix socket or TCP, whichever you run):

```sh
curl -s --unix-socket /run/searxng/searxng.sock \
  "http://localhost/search?q=gfx1151+rocm&engines=bing&format=json" \
  | jq '{n: (.results | length), unresponsive: .unresponsive_engines}'
```

Repeat for each engine in your set, then check the full response's `unresponsive_engines`
and eyeball relevance (for a technical query, do the top-10 titles/urls even contain the
query's tokens?):

```sh
curl -s --unix-socket /run/searxng/searxng.sock \
  "http://localhost/search?q=gfx1151+rocm&format=json" \
  | jq '{results: (.results | length), broken: .unresponsive_engines,
         relevant: [.results[:10][] | select((.url + " " + .title) | test("rocm"; "i"))] | length}'
```

Four engines hard-failing and one "succeeding" with unrelated hits = a flagged egress IP.
A control datapoint helps: if another instance on a *different* egress gets good results
for the same query, the query and the parsers are fine — only the egress is broken.

### The fix lives in SearXNG's `outgoing.proxies`, never in webveil

webveil only talks to your SearXNG instance (usually over a local socket); the engines
never see webveil or its hop. The hop the engines see is **SearXNG's own engine crawl**,
so that is the only hop a fix can live in. Rotate the crawl's exit IP in SearXNG's
`settings.yml` — a WireGuard-to-SOCKS5 tunnel (Mullvad, wireproxy/ProtonVPN) or a
rotating-residential gateway; SearXNG round-robins a *list* of proxies per request and
suspends CAPTCHA'd engines with backoff, so a list gives request-level rotation for free:

```yaml
outgoing:
  proxies:
    all://:
      - socks5h://127.0.0.1:1080   # the tunnel's local SOCKS5 port
```

There is **nothing to fix in webveil** — no webveil setting can change the IP the engines
see (that is the whole point of [Where does anonymity
live?](../README.md#where-does-anonymity-live-read-before-turning-on-egress): proxy the
hop that reaches the public internet).

### What webveil does about this — and what it honestly cannot

webveil threads SearXNG's `unresponsive_engines` through to callers:

- **Some engines down, others answered** — the results are annotated
  (`unresponsiveEngines` on every hit; the CLI/MCP output hoists it to a top-level field,
  the pi extension renders a `[warning] search degraded …` line). Partial results are
  still useful, so this does not fail — it just stops pretending a degraded answer is a
  clean one.
- **Zero results + engines unresponsive** — treated as a full outage: the search fails
  loud (an error naming the engines) instead of returning a confident empty list. The
  JSON response does not report the instance's full engine set, so "no results and
  failures" is the closest observable signature of every engine being down.

**Honest limit:** webveil **cannot detect junk results.** A 200 decoy SERP is
indistinguishable from a real one at webveil's layer — the engine reported success, the
results parse as hits, and nothing in the payload says "these are garbage". When the
surviving engine serves decoys, the response will look *clean* (no annotation) while
being garbage end to end; the only fix is at the egress level, above. Degradation
surfacing is a smoke detector, not a junk filter.
