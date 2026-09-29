# web_fetch through a browser fingerprint, and through searchcast as a last resort

Raised 2026-09-29 by the owner ("webveil web_fetch should ideally use searchcast fetch, no?") while the serpcast backend was being built. The `serpcast-backend` spec lists "Routing `web_fetch` through the impersonated transport" as out of scope, so this is the follow-up.

## Status (2026-09-29)

Step 2 is done (task `web-fetch-via-serpcast-transport`): `fetchTransport` (`plain` | `serpcast`, env `WEBVEIL_FETCH_TRANSPORT`) selects it, defaulting to `serpcast` when `backend` is `serpcast` (owner decision, which also answers the first open question below for that backend), with the adapter in `packages/webveil/src/core/fetch-transport.ts`. Step 3 (searchcast) remains an idea. The "Today" section below describes the state before step 2.

## Today

`web_fetch` runs distilly's `urlToMarkdown` with webveil's guarded egress fetch injected (ADR 0001): undici, so a Node TLS/HTTP2 fingerprint. Sites that gate on fingerprint or serve a challenge get a block page or an empty JS shell. searchcast has no fetch capability today: its API is `/search`, `/recipes`, `/health` only.

## Shape that fits the existing seams (a ladder, cheapest first)

1. **Plain egress fetch** (today). Most pages work, cost is one request.
2. **serpcast transport as the injected fetch.** distilly already takes an injected `fetch`, so a `fetch`-shaped adapter over serpcast's transport session (pinned Chrome TLS/HTTP2, the `document` header table, the same proxy mapping as the serpcast backend) slots into the same seam with no distilly change. Same egress, same SSRF guard wrapper, one request, no browser. Needs: serpcast exposing its transport in a fetch-like shape (it has `createTransport().session().request()`, GET only, redirects not followed, so the adapter follows redirects and runs the SSRF check per hop).
3. **searchcast, a real browser, for JS-rendered pages and challenges.** Needs a new searchcast capability (for example `GET /fetch?url=` and a library `fetch(url)` returning the rendered HTML and final URL), then distilly's pure core converts that HTML. This is the expensive and security-sensitive step: a browser loads subresources, follows redirects and runs page JavaScript, none of which passes through webveil's per-request SSRF guard. It is only safe when every browser request is forced through the egress proxy (library mode, as in `searchcast-fallback-and-guard`), local and private addresses are unreachable from it, and the profile is per identity. Endpoint mode cannot be made safe for fetch for the same reason it is refused for non-direct egress in search.

Escalation triggers: HTTP 403/429/202, a known challenge page, or extracted text that is empty or tiny for a 200 HTML response. Each step is opt-in config; escalation never silently changes egress.

## Open questions

- Should step 2 become the default fetch path once libcurl-impersonate is installed, or stay opt-in?
- For step 3, which request classes must the browser block outright (private IPs, `file:`, non-http schemes) and can Chromium enforce that with only a proxy plus `--host-resolver-rules`?
- Does searchcast want a generic fetch at all, or should webveil drive Chromium through searchcast's library directly?
