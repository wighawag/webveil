---
title: SearXNG install-script socket speaks uwsgi protocol, NOT HTTP — webveil's unix: baseUrl cannot reach the DEFAULT install socket
slug: searxng-script-socket-is-uwsgi-not-http
type: finding
status: spotted
created: 2026-06-27
source: 'First-hand SearXNG install-script install on this machine (2026-06-27): the generated uWSGI ini `/etc/uwsgi/apps-available/searxng.ini` uses `socket = /usr/local/searxng/run/socket` (uwsgi protocol). `curl --unix-socket … -I http://localhost/` returned HTTP 000; after flipping to `http-socket =` + `limiter: false` + `formats:[html,json]`, `curl … /search?format=json` returned real JSON. Confirms the SearXNG-docs reading in searxng-install-topology.md with real results. (This finding absorbed the working notes previously in install_searxng/INSTALLING_SEARXNG.md, since deleted.)'
---

Verified external ground truth that CORRECTS a premise the `searxng-unix-socket-baseurl`
feature shipped on. It does NOT invalidate the feature; it invalidates the DOCS' chosen
example.

## The fact: the default install-script socket is uwsgi-protocol, not HTTP

`sudo -H ./utils/searxng.sh install all` generates a uWSGI service whose ini binds:

```
socket = /usr/local/searxng/run/socket
chmod-socket = 666
```

`socket = …` is the **native uwsgi protocol**, NOT HTTP. (`http-socket = …` would be HTTP
over the socket; the install script does NOT use that.) Proof from the install on this box:

```sh
curl --unix-socket /usr/local/searxng/run/socket -I http://localhost/   # -> HTTP 000
```

HTTP 000 = no HTTP response: the listener does not speak HTTP. The default socket is meant
to be consumed by a reverse proxy via `uwsgi_pass` (nginx/Caddy/Apache) that talks the uwsgi
protocol to the socket and HTTP to the browser. Right after `install all` the uwsgi service
is active and the socket exists (`srw-rw-rw-`), but nothing is bound on 80/443/8888 and no
proxy is installed, so SearXNG is up but unreachable over HTTP until you add a proxy OR
switch the socket to `http-socket`.

## Why this matters for webveil (the drift — since CORRECTED in the docs)

webveil's `unix:` baseUrl (the `searxng-unix-socket-baseurl` task, merged in PR #11) dials
the socket with **undici over HTTP** (`Agent({connect:{socketPath}})` + an
`http://localhost…` request). undici speaks HTTP; it CANNOT speak the uwsgi protocol. So:

- `WEBVEIL_BASE_URL=unix:/usr/local/searxng/run/socket` against the **DEFAULT install-script
  socket** FAILS (the socket isn't HTTP) — it will not return search results until the
  socket is switched to `http-socket` (see the recipe below).
- The feature's first docs (README "Other SearXNG install options" and
  `searxng-install-topology.md`) originally used that default socket path as the example and
  claimed webveil "dials the socket directly" with "no uWSGI edit". That was wrong for the
  default install — doc drift introduced by the feature, not a code bug in the parser. **It
  has since been corrected** (this session): both docs now state the socket must be
  `http-socket` first. The CODE was always correct (it reaches any HTTP unix socket); only
  the example was wrong.

## Verified working recipe (end to end, 2026-06-27)

Proven on this machine: webveil reaching the install-script SearXNG over the unix
socket requires THREE changes, not just the `http-socket` flip:

1. **uWSGI: `socket = …` -> `http-socket = /usr/local/searxng/run/socket`** in
   `/etc/uwsgi/apps-available/searxng.ini` (the `http` plugin is already loaded).
   Without this the socket speaks uwsgi and `curl` gets HTTP 000.
2. **`settings.yml`: `server.limiter: false`** (+ `public_instance: false`).
   With the limiter ON, even a correct GET to the JSON API returns
   `429 TOO MANY REQUESTS` (a bare `curl -I` HEAD is especially limiter-prone).
   A 429 is a REAL HTTP response, so it confirms the socket is HTTP — the block is
   the limiter, not the transport.
3. **`settings.yml`: `search.formats` must include `json`** (often disabled by
   default). webveil calls `/search?format=json`.

After all three + `systemctl restart uwsgi.service`, this returns real JSON over
the socket:

```sh
curl -s --unix-socket /usr/local/searxng/run/socket \
  "http://localhost/search?q=test&format=json" -H 'Accept: application/json'
# -> {"query": "test", "results": [{"url": "https://...", "title": "..."}, ...]}
```

and `WEBVEIL_BASE_URL=unix:/usr/local/searxng/run/socket webveil search "…"`
works. The limiter/format requirement is NOT webveil-specific (any HTTP consumer
of the JSON API hits it), but it is part of the "make the script install usable
by webveil" path. The exact config-file lines:

- uWSGI ini: `/etc/uwsgi/apps-available/searxng.ini` (the `apps-enabled/` entry is a
  symlink to it); change the one `socket =` line to `http-socket =`. The `http` plugin is
  already loaded (`plugin = python3,http`), so no extra plugin install.
- `settings.yml` (script-install default `/etc/searxng/settings.yml`): `server.limiter`,
  `server.public_instance`, `search.formats`.
- Restart with `sudo systemctl restart uwsgi.service` (service name is `uwsgi.service` on
  this box; `sudo service uwsgi restart` also works).

## Coexisting with a Caddy (or nginx) browser frontend

Question that comes up: with `http-socket` set for webveil, can you still run a Caddy
frontend, or must you revert to `socket =`? You do NOT need to revert. The deciding fact is
the PROTOCOL each hop speaks:

- Caddy's plain `reverse_proxy unix//…` speaks **HTTP** to its upstream (Caddy is an HTTP
  proxy unless you explicitly configure a uwsgi transport).
- `http-socket =` makes uWSGI speak **HTTP** on the socket; `socket =` makes it speak the
  **uwsgi protocol**.
- One socket FILE has exactly one listener.

So:

- **Simplest (recommended): one `http-socket`, both consume it.** webveil points
  `unix:/…/socket` at it AND Caddy `reverse_proxy unix//…/socket` at it, both over HTTP. No
  `socket =` needed. (Limiter is off for webveil, so a PUBLIC Caddy site then has no
  bot/rate protection, fine on localhost/LAN, re-enable + allowlist if internet-facing.)
- **Keep the uwsgi path for the browser:** give uWSGI TWO listeners, e.g.
  `socket = /usr/local/searxng/run/socket` (uwsgi -> Caddy via `transport uwsgi`) AND
  `http-socket = /usr/local/searxng/run/http.sock` (HTTP -> webveil at
  `unix:/usr/local/searxng/run/http.sock`). uWSGI supports multiple socket lines. The
  `transport uwsgi` directive needs a Caddy build that ships the uwsgi transport module
  (the standard binary does not), which is why option 1 is simpler.
- **Or a TCP `http-socket` for the proxy** (`http-socket = 127.0.0.1:8888`) and let Caddy
  `reverse_proxy 127.0.0.1:8888` while webveil uses the same TCP address, also all-HTTP.

## What the `unix:` feature IS actually good for (it is NOT dead)

The feature is correct for any **HTTP-over-unix-socket** server. It is reachable when the
socket speaks HTTP, e.g.:

- uWSGI configured with **`http-socket = /usr/local/searxng/run/socket`** instead of
  `socket = …` (edit the generated ini). Then `unix:` works directly, no proxy, no TCP port.
- A reverse proxy (Caddy/nginx) bound to a **unix socket** that speaks HTTP on it.
- Any other HTTP server that listens on a unix socket.

So the real shape is: webveil's `unix:` reaches an **HTTP** unix socket; SearXNG's
install-script default is a **uwsgi** unix socket; bridging the two needs either an
`http-socket` uWSGI edit OR a proxy. The "no uWSGI edit, no proxy" framing in the docs is
the false part.

## Resolution + a remaining idea

- **Doc fix: DONE (this session).** The README "Other SearXNG install options" section and
  `searxng-install-topology.md` were corrected to (a) state the install-script socket is
  uwsgi-not-HTTP, (b) require the `http-socket` flip (or a proxy) before `unix:` works, and
  (c) call out the limiter + JSON-format requirement. The standalone source notes
  (`install_searxng/INSTALLING_SEARXNG.md`) were absorbed into this finding and deleted.
- **Remaining idea (not done): a fail-loud / hint on a non-HTTP socket.** webveil cannot
  easily detect uwsgi-vs-http on a socket before connecting, but a connect that yields a
  non-HTTP/garbage response could carry a hint ("is this a uwsgi `socket =`? webveil needs
  `http-socket =`"). Lower priority; the doc fix was the load-bearing one. Per the user's
  decision, webveil will NOT add native uwsgi-protocol support (it stays HTTP-only), so this
  hint is the only code-side follow-up worth considering.

## Install ground truth (absorbed from the now-deleted INSTALLING_SEARXNG.md)

Verified first-hand, generally useful for anyone standing up a script-install SearXNG for
webveil:

- **Two source trees after `install all`.** The installer makes its OWN fresh clone into the
  SERVICE home `/usr/local/searxng/searxng-src` (owned by the `searxng` user); that is the
  tree the running instance + `./utils/searxng.sh update` use. Whatever tree you launched
  the installer from is only the `$REPO_ROOT` it cloned FROM and is otherwise unused — a
  "which tree is real?" trap. Maintenance commands run from `/usr/local/searxng/searxng-src`:
  `sudo -H ./utils/searxng.sh update | inspect | instance check | remove`.
- **Hardened-home install failure.** On a machine with a private home dir (mode `0710`,
  `drwx--x---`), `sudo -H ./utils/searxng.sh install all` aborts with
  `user 'searxng' missed read permission: $REPO_ROOT` (searxng.sh ~line 423), because the
  `searxng` service user (an "other") cannot traverse the home dir to read the clone the
  installer checks it can read. Fix: clone/move the source to a world-traversable system
  path (e.g. `sudo mv … /usr/local/share/searxng-src && sudo chmod o+rX
  /usr/local/share/searxng-src`) and run the installer from THERE (`REPO_ROOT` derives from
  where `utils/searxng.sh` lives), rather than `chmod o+x` the whole private home (which
  weakens privacy). The official docs clone into `~/Downloads`, which works only because the
  typical Debian/Ubuntu home is `0755` (world-traversable); a `0710` home breaks that
  implicit assumption. (Because the installer re-clones into the service home anyway, the
  moved tree is only needed to PASS the permission check; it can be deleted after install.)
- **Valkey dependency.** SearXNG uses Valkey (Redis fork) on `localhost:6379 db=0` for the
  rate-limiter / bot-detection limiter; the post-install `instance check` confirms
  `connected to Valkey`. `max_request_timeout=None` in that check is informational (no
  global request timeout configured, the default).
- **Install a reverse proxy** (if you want a browser UI rather than the `http-socket`
  webveil path) from the service tree: `cd /usr/local/searxng/searxng-src && sudo -H
  ./utils/searxng.sh install nginx` (or `install caddy`).
- **Verify the instance:** `sudo systemctl status uwsgi.service`,
  `ls -la /usr/local/searxng/run/socket` (expect `srw-rw-rw-`), and
  `cd /usr/local/searxng/searxng-src && sudo -H ./utils/searxng.sh instance check`.
