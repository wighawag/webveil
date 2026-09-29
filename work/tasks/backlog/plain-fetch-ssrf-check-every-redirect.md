---
title: Run the SSRF guard on every redirect hop of the plain web_fetch path
slug: plain-fetch-ssrf-check-every-redirect
blockedBy: []
covers: []
---

## What to build

A security fix. `guardEgressFetch` (`packages/webveil/src/core/security.ts`) runs `assertPublicUrl` once, on the url handed to the wrapped fetch, then delegates to undici's `fetch`. distilly calls it with `{redirect: 'follow'}`, so undici follows redirects internally and the guard never sees the targets: on `direct` egress (the default) a public page that redirects to `http://169.254.169.254/...` (cloud metadata) or `http://127.0.0.1:<port>/` is fetched and its content returned to the agent (observation `work/notes/observations/plain-fetch-ssrf-guard-skips-redirect-targets.md`, resolved and deleted by this task). Make the guarded fetch follow redirects itself: call the wrapped fetch with `redirect: 'manual'`, and for 301/302/303/307/308 with a `Location`, resolve it against the current url, refuse non-http(s) targets, run `assertPublicUrl` on the target, and continue, at most 20 hops (the same rules as the `fetchTransport: serpcast` adapter in `core/fetch-transport.ts`; share the redirect loop if that keeps both small). Honour the caller's `redirect` mode: `follow` (distilly's) as above, `manual` returns the redirect response unchanged, `error` rejects on a redirect. Keep method and body semantics of the fetch spec for 303 (becomes GET) and 301/302 on POST (becomes GET); 307/308 keep the method (webveil only sends GET today, so keep this simple and record it). The returned `Response` must report the final `url` and `redirected`, since distilly resolves relative links against it.

Under a proxy egress the guard relaxes entirely today (no local DNS, the proxy owns egress); keep that behaviour for redirects too, and record it.

## Acceptance criteria

- [ ] On `direct` egress, a public URL answering 302 to `http://127.0.0.1:<port>/` (and, separately, to a hostname that resolves to a private address) is refused with an `SsrfError` before the target is requested (a local test server records that it was never hit).
- [ ] Legitimate redirect chains (relative and absolute, across hosts) still work and the final `Response.url` is the last hop; `web_fetch` output for them is unchanged.
- [ ] More than 20 hops is an error; a redirect to a non-http(s) scheme is refused.
- [ ] Under `http`/`socks5` egress behaviour is unchanged (no local DNS lookups), tested.
- [ ] Existing fetch and security tests pass unchanged; a changeset (patch) describes the fix.

## Blocked by

- None, can start immediately.

## Prompt

Goal: the SSRF guard covers every request `web_fetch` makes, including redirect targets (ADR 0001). Read `core/security.ts`, `core/egress.ts`, `core/fetch.ts` and `core/fetch-transport.ts` first. FIRST, check this task against current reality. RECORD non-obvious decisions.
