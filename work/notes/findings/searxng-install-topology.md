---
title: SearXNG install topology, script install uses a Unix socket, not a TCP port
slug: searxng-install-topology
source: 'SearXNG docs retrieved 2026-06-26: docs.searxng.org/admin/installation-scripts.html and /admin/installation-uwsgi.html (the generated uwsgi ini)'
---

External ground truth about how SearXNG exposes itself, because webveil needs an HTTP
`host:port` for its backend `baseUrl` and the install method changes whether one exists.

## The script install does NOT bind a TCP port by default

`sudo -H ./utils/searxng.sh install all` sets up SearXNG as a uWSGI service whose generated
ini binds a UNIX DOMAIN SOCKET, not a port:

```
socket = /usr/local/searxng/run/socket
```

So there is no `127.0.0.1:8080`/`:8888` to hit after the script install. This is WHY the
SearXNG docs then tell you to set up nginx/apache: the reverse proxy bridges
HTTP-on-a-port <-> the uWSGI socket. The proxy is not just "for the web interface" \u2014 it is
what creates the single HTTP endpoint that BOTH a browser and webveil use (webveil just
appends `&format=json`).

## webveil needs HTTP host:port (or, now, the socket itself)

webveil's backends call `baseUrl` over HTTP via undici/`fetch`. undici connects to TCP
ports AND (via `Agent({connect:{socketPath}})`) to Unix domain sockets BUT ONLY OVER HTTP.
The install-script default socket speaks the **uwsgi protocol, not HTTP** (`socket = …`, not
`http-socket = …`; `curl --unix-socket … http://localhost/` returns HTTP 000), so webveil's
`unix:` baseUrl CANNOT reach the default socket directly — see
`searxng-script-socket-is-uwsgi-not-http.md`. The bare script install has THREE fixes:

0. **Point webveil straight at an HTTP unix socket** (the third option, added by the
   `searxng-unix-socket-baseurl` task). This needs an HTTP-speaking socket, which the
   install-script default is NOT, so first make uWSGI serve HTTP on it: replace
   `socket = /usr/local/searxng/run/socket` with
   `http-socket = /usr/local/searxng/run/socket` in the generated ini. THEN set `baseUrl`
   to a `unix:` URL naming the socket file:
   ```sh
   export WEBVEIL_BASE_URL=unix:/usr/local/searxng/run/socket
   ```
   webveil parses `unix:<socketPath>[:<httpPath>]` into `{socketPath, httpPath}`, builds a
   per-backend-hop socket `Agent`, and issues its normal request against a synthetic
   `http://localhost<httpPath>/search?...&format=json` over it (the URL host is irrelevant
   to routing; the socket decides, the host is just the `Host` header). `httpPath` is the
   app's base/mount path and defaults to `/` (the backend appends `search`), so the example
   above requests `/search`. (`unix:` also works against any other HTTP-on-a-unix-socket
   server, e.g. a Caddy/nginx upstream bound to a socket.) **Egress must be `direct`:** a
   `unix:` baseUrl combined with `egress=http`/`socks5` fails loud (`EgressError`), because
   proxying a local socket is the same fake-anonymity footgun as proxying a loopback TCP
   baseUrl: SearXNG still crawls the web from your real IP, outside webveil's egress. Fix
   that by proxying SearXNG (`outgoing.proxies`) and keeping webveil `direct`. The socket
   transport is scoped to the BACKEND `baseUrl` hop ONLY (it is NOT bound into the shared
   `config.egress` dispatcher), so `web_fetch` of public URLs still goes out over the normal
   direct path.
1. **Reverse proxy in front of the socket.** Any HTTP server works \u2014 the docs say
   explicitly "we do not have any preferences regarding the HTTP server, you can use
   whatever you prefer." They ship pre-written configs for nginx and apache only, but
   Caddy works fine (and supports unix upstreams):
   ```
   searxng.example.com {
       reverse_proxy unix//usr/local/searxng/run/socket
   }
   ```
   Set SearXNG `server.base_url` to match; the limiter/bot-protection can need correct
   forwarded headers behind a proxy.
2. **Make uWSGI listen on TCP instead.** Replace `socket = .../run/socket` with
   `http-socket = 127.0.0.1:8888` in the generated ini; point webveil at
   `http://127.0.0.1:8888`. No proxy needed (good when only webveil consumes it).

## Docker is the exception (binds a port directly)

The Docker image binds 8080 internally (entrypoint forces `0.0.0.0:8080`), so
`docker run -p 8080:8080 searxng/searxng` gives a TCP port with no proxy needed \u2014 matches
webveil's default `baseUrl`. (Port nuance: bare-metal/pip default is 8888 via
`settings.yml server.port`; Docker overrides to 8080; SearXNG docs' manual example maps
`-p 8888:8080`.)

## Decision tree for webveil

- Only webveil, no public UI -> Docker (port) OR script-install + `unix:` baseUrl straight
  at the socket (no proxy, no uWSGI edit) OR script-install with uWSGI on a TCP port.
  No proxy.
- webveil + browser UI on a domain with TLS, and you use Caddy -> script install (socket)
  + Caddy `reverse_proxy unix/...`. Point webveil at a LOCAL port/socket bypass so its
  queries don't traverse the public TLS path unnecessarily.
