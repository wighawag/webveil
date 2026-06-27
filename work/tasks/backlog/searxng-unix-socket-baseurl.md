---
title: Let webveil reach a SearXNG Unix socket directly (unix: baseUrl, no reverse proxy)
slug: searxng-unix-socket-baseurl
blockedBy: []
covers: []
---

## What to build

Allow webveil's backend `baseUrl` to point at a **Unix domain socket** so the SearXNG
install-script topology (uWSGI listening on `socket = /usr/local/searxng/run/socket`, NOT a
TCP port) works WITHOUT a reverse proxy or a uWSGI `http-socket` edit. Today webveil's HTTP
goes through undici/`fetch`, which connects to TCP only, so this install path forces the
user into one of the two README workarounds (front it with Caddy/nginx, or switch uWSGI to
a TCP port). This task adds a third, zero-extra-process option: point webveil straight at
the socket file.

Shape (from the prototype, see Decisions): introduce a `unix:` `baseUrl` scheme that
encodes BOTH the socket path AND the request path, e.g.

```
unix:/usr/local/searxng/run/socket:/search
```

(socket path, then `:`, then the HTTP path the backend appends its query to). webveil
parses this into `{socketPath, httpPath}`. The backend then issues its normal request
against a synthetic `http://localhost<httpPath>?...&format=json`, carried over an undici
`Agent({connect: {socketPath}})`. The URL host is irrelevant for routing (the socket
decides) and just becomes the `Host` header.

**CRITICAL seam fact (verified against the code, do not get this wrong):** the existing
egress dispatcher (`buildDispatcher(config)` in `core/egress.ts`) is built ONCE from config
and **shared by BOTH `search()` (backend → SearXNG) AND `fetch()` (the egress-bound fetch
that hits arbitrary PUBLIC urls + distilly)** — see `core/search.ts` and `core/fetch.ts`,
which both call `buildDispatcher(config)`. Therefore a socket dispatcher MUST NOT be bound
into that shared config-wide egress dispatcher: if it were, every `web_fetch` of a public
URL would be routed into the SearXNG socket and break. The socket transport belongs to the
**backend `baseUrl` hop ONLY**, not to `config.egress`. Two consequences the builder MUST
honour:

1. The socket `Agent` is selected **per the backend `baseUrl`** (the searxng backend's
   request), NOT returned from `buildDispatcher` as the config-wide egress dispatcher. The
   `fetch()`/SSRF egress fetch keeps using the normal `direct` (un-socket) dispatcher.
2. The searxng backend currently builds its URL with `new URL('search', baseUrl + '/')`
   then `searchParams.set(...)` (see `core/backends/searxng.ts` `buildUrl`). A raw `unix:…`
   string is NOT a valid base for `new URL('search', …)`, so the `unix:` → `{socketPath,
   httpPath}` parse + synthetic-`http://localhost…` rewrite must happen at/before the point
   the backend constructs its request URL, so `buildUrl`'s `URL`/`searchParams` logic still
   works unchanged on a real `http:` base. Decide and STATE where that translation lives
   (a small helper the searxng backend / http layer applies to `baseUrl`), and how the
   socket `Agent` is threaded to the request for that hop only.

Scope / precision:

- **Direct egress ONLY.** A Unix socket is inherently local, so a `unix:` baseUrl is only
  meaningful with `egress.mode === 'direct'`. Combining a `unix:` baseUrl with a non-direct
  egress (`http`/`socks5`) is a misconfiguration in the same family as the loopback guard
  (`fail-loud-on-proxied-loopback-backend`): proxying a local-socket call gives fake
  anonymity while SearXNG crawls the web from the real IP. **Fail loud** (`EgressError`)
  with a message pointing at the real fix (proxy SearXNG's `outgoing.proxies`, keep webveil
  direct). Treat a `unix:` baseUrl as loopback-equivalent for that existing guard's purpose.
- Backends stay **transport-unaware**: they keep calling the injected `http` helper, and the
  socket-vs-TCP choice for the backend hop is made for them (not by teaching the searxng
  backend about sockets). The seam that already hides direct-vs-proxy hides TCP-vs-socket
  too — but, per the CRITICAL fact above, that seam is the **backend-hop** transport, NOT
  the shared `config.egress` dispatcher.
- The SSRF guard and `web_fetch` are unaffected: this is about the BACKEND `baseUrl` hop,
  not arbitrary fetch targets. `web_fetch` does not gain a `unix:` mode, and (per the
  CRITICAL fact) the socket dispatcher must not leak into the fetch/SSRF egress path.
- Config: `baseUrl` already flows through `core/config.ts` (env `WEBVEIL_BASE_URL` /
  `.pi/webveil.json`). No new config key, just a new accepted `baseUrl` form. Document it in
  the README's "Other SearXNG install options" section as the third option, and update
  `work/notes/findings/searxng-install-topology.md`'s "two fixes" to "three fixes".

## Acceptance criteria

- [ ] A `unix:<socketPath>:<httpPath>` `baseUrl` with `egress=direct` reaches a SearXNG-like
      HTTP server listening on that Unix socket and returns results (search works end to
      end against a socket-bound test server).
- [ ] The request path/query (`&format=json` etc.) is preserved and sent against the socket;
      the synthetic URL host is irrelevant to routing.
- [ ] A `unix:` `baseUrl` combined with `egress` = `http` or `socks5` throws `EgressError`
      (fail-loud), consistent with the loopback false-confidence guard, with an actionable
      message.
- [ ] A normal `http://host:port` `baseUrl` is completely unaffected (TCP path unchanged);
      no new dependency is added (undici already supports `connect.socketPath`).
- [ ] **The socket transport does NOT leak into `web_fetch`:** with a `unix:` SearXNG
      `baseUrl` configured, a `web_fetch` of an ordinary public URL still goes out over the
      normal direct (non-socket) path — it is NOT routed into the SearXNG socket. (Guards
      against binding the socket into the shared `config.egress` dispatcher.)
- [ ] **Shared/global isolation:** the socket-server test binds its socket inside a
      temp/scratch dir and removes it after; it does NOT touch any real
      `/usr/local/searxng/...` path, and asserts no real socket/file is created or left
      behind outside the temp fixture.
- [ ] README "Other SearXNG install options" and
      `work/notes/findings/searxng-install-topology.md` updated to list the direct-socket
      option as a first-class third path (with the egress=direct-only caveat).

## Blocked by

- None, can start immediately. Soft-related to `fail-loud-on-proxied-loopback-backend`
  (shares the false-confidence rationale); if that task lands first, REUSE its guard /
  loopback classification and extend it to treat `unix:` as loopback-equivalent rather than
  adding a parallel check. If this lands first, leave a clear seam for that task.

## Prompt

> Add a `unix:` `baseUrl` scheme to webveil so it can reach a SearXNG Unix domain socket
> (the install-script default: `socket = /usr/local/searxng/run/socket`, no TCP port)
> directly, without a reverse proxy. Read `work/notes/findings/searxng-install-topology.md`
> (why the script install has no TCP port and the existing two workarounds) and
> `work/notes/findings/webveil-anonymity-boundary.md` (why a local hop must NOT be proxied,
> the false-confidence rule). The relevant seams: `core/egress.ts` builds the undici
> dispatcher per egress mode; `core/http.ts` and the egress-bound fetch consume it;
> `core/config.ts` resolves `baseUrl`. The SSRF guard is `core/security.ts`.
>
> PROTOTYPE-CONFIRMED MECHANISM (encodes the decision, do not re-derive): undici reaches a
> Unix socket with `new Agent({connect: {socketPath}})`, no extra dependency (undici 7 is
> already in the tree). The URL hostname is irrelevant for routing (the socket decides) and
> only becomes the `Host` header, so the backend can issue its normal request against a
> synthetic `http://localhost<httpPath>?...&format=json` over that dispatcher. Proven with a
> `node:http` server bound to a temp `.sock`: a `fetch('http://localhost/search?q=...&format=json', {dispatcher})`
> returned the body with the path/query intact.
>
> Design: introduce a `unix:<socketPath>:<httpPath>` baseUrl form (socket path, then `:`,
> then the HTTP path). Parse it into `{socketPath, httpPath}` and rewrite the backend's
> request to a synthetic `http://localhost<httpPath>` carried over an
> `Agent({connect:{socketPath}})`.
>
> READ THE SEAM BEFORE CODING (the trap this task exists to prevent): `buildDispatcher(config)`
> is built ONCE and SHARED by both `core/search.ts` (backend hop) and `core/fetch.ts` (the
> egress fetch to arbitrary PUBLIC urls + distilly). Do NOT make `buildDispatcher` return the
> socket `Agent` — that would route every `web_fetch` into the SearXNG socket. The socket
> transport is for the BACKEND `baseUrl` hop ONLY; the fetch/SSRF egress path keeps its
> normal direct dispatcher. Also: the searxng backend builds its URL with
> `new URL('search', baseUrl + '/')` + `searchParams` (`core/backends/searxng.ts`), which a
> raw `unix:…` string breaks — so the `unix:` parse + synthetic-`http://localhost` rewrite
> must happen BEFORE that URL construction (a small helper applied to `baseUrl`), keeping the
> backend transport-unaware. Keep TCP `baseUrl` behaviour byte-for-byte unchanged.
>
> Anonymity guard: a `unix:` baseUrl is inherently local, so REFUSE it with a non-direct
> egress (`http`/`socks5`) by throwing `EgressError` — same false-confidence family as the
> loopback guard. If `fail-loud-on-proxied-loopback-backend` has landed, extend ITS guard to
> treat `unix:` as loopback-equivalent instead of writing a parallel check; if not, add a
> minimal check here and leave a seam noting the overlap. Do NOT touch `web_fetch`/SSRF
> (that owns arbitrary targets; no `unix:` fetch mode).
>
> Test end to end against a `node:http` server bound to a UNIX socket inside a TEMP dir
> (isolate: never touch a real `/usr/local/searxng/...` path; assert nothing is left outside
> the temp fixture). Cover: socket baseUrl + direct works; query/path preserved; socket
> baseUrl + http/socks5 fails loud; normal TCP baseUrl unaffected; no new dependency.
> Update the README "Other SearXNG install options" section and
> `work/notes/findings/searxng-install-topology.md` to add the direct-socket path as a
> first-class third option (with the egress=direct-only caveat).
>
> Done = the four+ test cases above are green, README + finding updated, verify gate
> (`pnpm format:check && pnpm build && pnpm test`) passes. RECORD non-obvious in-scope
> decisions: the exact `unix:` baseUrl grammar (e.g. why `:` separates socket path from HTTP
> path, how an empty httpPath defaults), and where parsing lives. If the grammar choice is
> hard to reverse + surprising, write a short ADR in `docs/adr/`; otherwise a `## Decisions`
> line in the done record.

## Decisions (from the prototyping done while drafting this task)

- **undici natively supports Unix sockets** via `Agent({connect: {socketPath}})`; no new
  dependency is needed (confirmed against undici 7.28.0, already in the lockfile). The work
  is a small backend-hop transport addition, NOT a config-wide egress change (see next
  point).
- **The egress dispatcher is SHARED between search and fetch** (`buildDispatcher(config)` in
  `core/egress.ts`, called by both `core/search.ts` and `core/fetch.ts`). A review pass
  against the code caught that binding the socket into that shared dispatcher would route
  every `web_fetch` of a public URL into the SearXNG socket. So the socket transport is
  scoped to the backend `baseUrl` hop only, and the searxng backend's existing
  `new URL('search', baseUrl)` construction forces the `unix:` parse to happen before URL
  building. This is the load-bearing constraint the prompt and the `web_fetch`-isolation
  acceptance criterion encode.
- **Routing is by socket path, not URL host.** The prototype hit a temp-socket `node:http`
  server with `fetch('http://localhost/search?q=test&format=json', {dispatcher})` and got
  `{"url":"/search?q=test&format=json","host":"localhost"}` back — the path + query survive,
  the host is just a header. This is what makes a synthetic `http://localhost<httpPath>` URL
  safe to use as the carrier for the backend's normal request.
- **`unix:` is direct-only by nature**, so it folds into the existing false-confidence
  anonymity stance rather than introducing a new policy axis: a local socket proxied through
  socks5/http is the same fake-anonymity footgun as a loopback TCP baseUrl, hence the
  fail-loud requirement and the explicit overlap with
  `fail-loud-on-proxied-loopback-backend`.
