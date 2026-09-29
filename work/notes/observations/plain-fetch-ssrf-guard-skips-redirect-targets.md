---
title: the plain web_fetch path runs the SSRF guard on the first url only, not on redirect targets
slug: plain-fetch-ssrf-guard-skips-redirect-targets
---

Observed 2026-09-29 while building `web-fetch-via-serpcast-transport` (by reading the code, not reproduced against a live server). `guardEgressFetch` (`packages/webveil/src/core/security.ts`) runs `assertPublicUrl` once, on the url handed to the wrapped fetch, then delegates to undici's `fetch`; distilly calls it with `{redirect: 'follow'}` (`distilly/dist/fetch.js`), so undici follows redirects internally and the guard never sees the targets. On `direct` egress a public page that redirects to `http://169.254.169.254/...` or `http://127.0.0.1:...` is therefore fetched. The `fetchTransport: serpcast` adapter (`core/fetch-transport.ts`) follows redirects itself and checks every hop; the plain path was left unchanged because that task requires `plain` to behave exactly as before. Suggested fix: have the guard pass `redirect: 'manual'` and follow redirects itself with the check per hop (as the serpcast adapter does), tested with a redirect to a private address.
