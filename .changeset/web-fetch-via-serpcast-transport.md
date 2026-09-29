---
'webveil': minor
'pi-webveil': minor
---

`web_fetch` can use a real browser's TLS and HTTP/2 fingerprint: the new `fetchTransport` key (`plain` or `serpcast`, env `WEBVEIL_FETCH_TRANSPORT`).

- **`serpcast`** sends `web_fetch` through serpcast's libcurl-impersonate transport (Chrome's fingerprint and page-load headers, GET only) instead of undici. It is the default when `backend` is `serpcast`; `plain` stays the default with every other backend. An explicit value always wins.
- **Same egress and SSRF guard.** It uses the fetch-hop egress (`fetchEgress`, else `egress`), with SOCKS always as `socks5h`. webveil follows redirects itself (at most 20) and runs the SSRF guard on every hop.
- **Strict, never a fallback.** Without libcurl-impersonate `web_fetch` fails with the fix (`npx serpcast install-libcurl` or `serpcast.libcurlPath`); it never falls back to `plain`. With the serpcast backend this means `web_fetch` now needs the library too, or `"fetchTransport": "plain"`.
- **No cookies between fetches**: each fetch is a fresh session, and nothing is written to the serpcast state.
- `serpcast.libcurlPath` keeps its trust rule for fetch (refused from a project `webveil.json`, including with `fetchEgress` set).
