---
'webveil': minor
'pi-webveil': minor
---

Per-hop egress: a new optional `fetchEgress` (env `WEBVEIL_FETCH_EGRESS` /
`WEBVEIL_FETCH_EGRESS_URL`) controls the `web_fetch` hop independently of the backend
hop's `egress`. This makes the most common self-hosted topology expressible and blessed:
a LOCAL SearXNG backend on a `direct` backend hop (its own `outgoing.proxies` anonymizes
the engine crawl) while `web_fetch` of arbitrary URLs exits through a SOCKS5 proxy (e.g.
wireproxy -> ProtonVPN at `socks5h://127.0.0.1:1080`).

`fetchEgress` defaults to inheriting `egress` when unset, so existing single-`egress`
configs are unchanged. The fail-loud false-confidence guard still rejects a NON-direct
`egress` on a LOCAL backend `baseUrl` (now covering loopback TCP as well as `unix:`
sockets), but it is scoped to the backend hop and does NOT block a proxied `web_fetch`.
See docs/adr/0003.
