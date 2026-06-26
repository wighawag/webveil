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

## webveil needs HTTP host:port, not a socket

webveil's backends call `baseUrl` over HTTP via undici/`fetch`, which connect to TCP ports,
not socket files. So with the bare script install, webveil has nothing to point at until an
HTTP front exists. Two fixes:

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

- Only webveil, no public UI -> Docker (port) OR script-install with uWSGI on a TCP port.
  No proxy.
- webveil + browser UI on a domain with TLS, and you use Caddy -> script install (socket)
  + Caddy `reverse_proxy unix/...`. Point webveil at a LOCAL port/socket bypass so its
  queries don't traverse the public TLS path unnecessarily.
