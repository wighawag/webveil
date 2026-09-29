---
title: web_fetch through serpcast's impersonated transport (Chrome TLS/HTTP2 fingerprint), selected by config
slug: web-fetch-via-serpcast-transport
spec: serpcast-backend
blockedBy: [custom-command-windows-backslash-paths]
covers: []
---

## What to build

`web_fetch` today runs distilly's `urlToMarkdown` with webveil's guarded egress fetch injected (undici, a Node fingerprint), so sites that gate on the TLS/HTTP2 fingerprint answer with a block or challenge page. Step 2 of the idea note `work/notes/ideas/web-fetch-through-browser-fingerprint-and-searchcast.md` (step 3, the searchcast browser, stays an idea). Owner decision (2026-09-29): make it configurable, defaulting to serpcast when the backend is serpcast.

- **Config:** a new top-level key `fetchTransport`: `"plain"` (today's undici path) or `"serpcast"`. Absent, it resolves to `"serpcast"` when `backend` is `serpcast` and to `"plain"` otherwise; an explicit value always wins (env `WEBVEIL_FETCH_TRANSPORT` too). Record the key name.
- **The serpcast path:** a `fetch`-shaped adapter over serpcast's exported `createTransport` (`serpcast@^0.1.0`: `createTransport({libcurlPath, proxy, strict, timeoutMs, maxBodyBytes}).session().request(url, {kind: 'document'})`), injected into distilly exactly where the plain egress fetch is injected today, so distilly's rules and pure core are unchanged. GET only (anything else is an error); the caller's request headers are ignored (the Chrome `document` header table is the only header set); redirects are followed by the adapter (serpcast's transport does not follow them), at most 20 hops; the result is a standard `Response`. One fresh transport session per `web_fetch` call: no cookies persist between fetches (record this; a fetch is not a search identity).
- **Egress:** the FETCH hop's egress (`fetchEgress ?? egress`, ADR 0003), mapped exactly as the serpcast backend maps the backend hop (reuse `serpcastProxy`: SOCKS always `socks5h`, `http` passes through, `direct` no proxy). Strict impersonation always on; an impersonation failure is an error carrying the install/path fix (reuse the backend's message), never a silent fallback to plain.
- **Library path:** `serpcast.libcurlPath`, trust-checked and resolved exactly as in the serpcast backend (executable key, refused from a project `webveil.json`, resolved absolute, never the cwd), without requiring `serpcast.engines` to be set (fetch does not need engines).
- **SSRF:** `assertPublicUrl` runs on EVERY hop, including each redirect target, before the request is sent (the adapter owns redirects, so it must). While there, check whether the plain undici path checks redirect targets too (the current guard only sees the initial URL if undici follows redirects internally); if it does not, fix it in the same way or record it as an observation, whichever keeps this task small.
- **Instance reuse:** cache the transport per resolved fetch identity (egress + library path), like the backend's instance cache, and close it with `closeBackends`.
- A backend's own `/extract` (tavily-compat) still wins over both transports as today.

## Acceptance criteria

- [ ] `fetchTransport` resolves as specified (default by backend, explicit value and env win), tested.
- [ ] With `serpcast`, distilly receives the adapter; requests go through a fake transport in tests (no native library in `verify`) with the fetch-hop proxy mapped as specified, the `document` kind, GET only, redirects followed with the SSRF check on every hop (a redirect to a private address on direct egress is refused), and a size or timeout failure surfaced as an error.
- [ ] The libcurl path from a project `webveil.json` is refused (file named) for fetch too, including on derived configs.
- [ ] Impersonation failure is a loud error with the fix; there is no fallback to plain.
- [ ] `fetchTransport: "plain"` (and the default with non-serpcast backends) behaves exactly as today; existing fetch tests pass unchanged.
- [ ] README (fetch section and config table) and CONTEXT.md document the key, the default rule, the egress mapping and the no-cookies decision; the idea note is updated to say step 2 is done.

## Blocked by

- custom-command-windows-backslash-paths (serialized: sequential drive)

## Prompt

Goal: `web_fetch` with a real browser's TLS fingerprint, same egress, same SSRF guarantees (ADR 0001, 0003, 0004). Read `core/fetch.ts`, `core/extract.ts`, `core/security.ts` and `core/backends/serpcast.ts` first, and serpcast's transport docs in its README. FIRST, check this task against current reality. RECORD non-obvious decisions.
