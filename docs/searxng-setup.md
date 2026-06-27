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
