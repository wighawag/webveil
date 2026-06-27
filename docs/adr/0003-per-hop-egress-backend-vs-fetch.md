# Per-hop egress: a distinct `fetchEgress` for the web_fetch hop

webveil's egress governs two genuinely independent outbound hops: the BACKEND hop
(webveil -> backend `baseUrl`) and the FETCH hop (webveil -> an arbitrary public URL,
and the `fetch` injected into distilly). The single most common self-hosted topology
wants them set differently: a LOCAL SearXNG backend reached on a `direct` backend hop
(its own `outgoing.proxies` anonymizes the engine crawl) WHILE `web_fetch` of arbitrary
URLs exits through a SOCKS5 proxy (e.g. wireproxy -> ProtonVPN at
`socks5h://127.0.0.1:1080`). A single config-wide `egress` could not express this.

**Decision:** add an OPTIONAL `Config.fetchEgress` that DEFAULTS to inheriting `egress`
when unset. `egress` governs the backend hop; `fetchEgress ?? egress` governs the fetch
hop (and the SSRF guard's proxy-relaxation keys on the fetch hop's mode). Env knobs
`WEBVEIL_FETCH_EGRESS` / `WEBVEIL_FETCH_EGRESS_URL` mirror `WEBVEIL_EGRESS*`. The
fail-loud false-confidence guard (`assertEgressAllowsBaseUrl`) stays scoped to the
BACKEND hop: it still throws `EgressError` when a NON-direct `egress` targets a LOCAL
(`unix:` socket or loopback-TCP: 127.0.0.0/8, `::1`, `localhost`) `baseUrl`, but it does
NOT consult `fetchEgress`, so a socks5 fetch hop with a local+direct backend is allowed.

## Considered options

- **Optional `fetchEgress` defaulting to `egress` (CHOSEN).** Backward compatible by
  construction: a config/env setting only `egress` leaves `fetchEgress` unset, so both
  hops behave exactly as before. Additive, semver-minor.
- **Make `egress` a `{backend, fetch}` pair (REJECTED).** Breaks every existing flat
  `egress` config/env and the `Egress` type's consumers; strictly larger and not
  backward compatible.

## Consequences

- The fetch-hop dispatcher / egress fetch / SSRF guard are built by handing the existing
  `buildDispatcher` / `createEgressFetch` / `guardEgressFetch` a config whose `.egress`
  is the resolved fetch-hop egress (a small `fetchEgressConfig(cfg)` helper). No new
  overloads; the SSRF relaxation correctly tracks the fetch hop, not the backend hop.
- A backend's OWN `/extract` (tavily-compat) reaches the backend `baseUrl`, so it stays
  on the BACKEND egress, NOT `fetchEgress`.
- The loopback-TCP arm of the backend guard (folding in the sibling task
  `fail-loud-on-proxied-loopback-backend`) reuses `core/security.ts` loopback
  classification (`isLoopbackHost`), and is deliberately tighter than `isPrivateIp`: a
  LAN/RFC1918 backend over SOCKS is a legitimate remote topology and must not trip it.
- Fail-loud is preserved on BOTH hops: a configured-but-unbuildable backend OR fetch
  proxy throws before any I/O; never a silent fall back to direct.
