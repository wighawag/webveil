---
title: Per-hop egress so a local SearXNG backend and a proxied web_fetch can coexist
slug: per-hop-egress-local-backend-proxied-fetch
blockedBy: []
covers: []
---

## What to build

Make webveil's egress configurable PER HOP so the most common self-hosted topology
becomes expressible and blessed: a LOCAL SearXNG backend (loopback TCP or `unix:`
socket) reached on a DIRECT backend hop, while `web_fetch` of arbitrary URLs exits
through a SOCKS5 proxy (e.g. wireproxy -> ProtonVPN at `socks5h://127.0.0.1:1080`).

Today `egress` is one config-wide setting governing BOTH hops, and the fail-loud
guard refuses any non-direct egress on a local backend `baseUrl`, so "local search +
proxied fetch" cannot be expressed at all. But the two hops are genuinely independent
(see `work/notes/findings/webveil-anonymity-boundary.md`):

1. the BACKEND hop (webveil -> backend `baseUrl`), and
2. the FETCH hop (webveil -> arbitrary public URL, the `fetch` injected into distilly).

Proxying the FETCH hop while the backend stays local+direct is NOT the false-confidence
combo (the fetch target is a real public URL, not the loopback `baseUrl`). The guard
just never let you say it.

## Design decision (the per-hop shape), RECORDED

Chosen shape: **a distinct optional `fetchEgress` that DEFAULTS to inheriting `egress`
when unset.** `egress` keeps governing the BACKEND hop; `fetchEgress` (when set)
governs the FETCH hop / distilly. Rationale and the rejected alternative:

- **Backward compatible by construction.** An existing config/env that sets only
  `egress` leaves `fetchEgress` unset, so the fetch hop inherits `egress` and behaves
  EXACTLY as today (single knob = both hops). No migration, no behaviour change.
- **The guard scopes to the BACKEND hop only.** `assertEgressAllowsBaseUrl` keeps
  firing on a non-direct **backend** egress with a local (`unix:` or loopback-TCP)
  `baseUrl` (the real false-confidence combo). It does NOT consult `fetchEgress`: a
  socks5 fetch hop with a local+direct backend is allowed.
- **Two resolver helpers make the hop explicit at the call site.** Search builds its
  dispatcher from the BACKEND egress (today's `cfg.egress`); fetch builds its
  dispatcher / egress fetch from the FETCH egress (`fetchEgress ?? egress`). The
  cleanest seam is a tiny `fetchEgressConfig(cfg)` that returns a `Config` whose
  `egress` is the resolved fetch-hop egress, so the existing `buildDispatcher(cfg)` /
  `createEgressFetch(cfg)` / `guardEgressFetch(f, cfg)` are reused UNCHANGED (they
  already key off `cfg.egress`, so handing them a config carrying the fetch-hop egress
  in `.egress` is the minimal, type-safe wiring). The SSRF guard's proxy-relaxation
  then correctly keys on the FETCH hop's egress (relax under a proxied fetch hop), not
  the backend hop's.
- Rejected: making `egress` itself a `{backend, fetch}` pair. That breaks every
  existing flat `egress` config/env and the `Egress` type's existing consumers; the
  additive optional field is strictly smaller and backward compatible.

### Why `fetchEgressConfig` returns a `Config` (not a bare `Egress`)

`buildDispatcher`, `createEgressFetch`, and `guardEgressFetch`/`assertPublicUrl` all
take a `Config` and read `.egress`. Returning `{...cfg, egress: resolvedFetchEgress}`
lets fetch.ts reuse them verbatim (no new overloads), and makes the SSRF guard relax on
the fetch hop's mode. The backend `baseUrl` carried along is irrelevant to the fetch
hop (fetch targets are arbitrary URLs), so no leakage.

## Config + env

- `Config.fetchEgress?: Egress`: optional; absent = inherit `egress`.
- `webveil.json`: `{ "egress": {...}, "fetchEgress": { "mode": "socks5", "url": "..." } }`.
- env: `WEBVEIL_FETCH_EGRESS` (`direct` | `http` | `socks5`) + `WEBVEIL_FETCH_EGRESS_URL`,
  parsed exactly like `WEBVEIL_EGRESS` / `WEBVEIL_EGRESS_URL`. Same precedence
  (env > project > global > defaults). `fetchEgress` is layered key-by-key like the
  rest; a layer that sets only `egress` does not invent a `fetchEgress`.

## Acceptance criteria

- [ ] Local backend (`unix:` socket OR loopback TCP) + DIRECT backend hop + `socks5`
      FETCH hop RESOLVES, BUILDS, and routes `web_fetch` through the socks dispatcher
      while `web_search` goes to the local SearXNG on the direct backend hop.
- [ ] The false-confidence combo still FAILS LOUD: a non-direct egress applied to a
      local (`unix:` or loopback-TCP) BACKEND `baseUrl` throws `EgressError` with the
      existing guidance. The loopback-TCP case is added to the SAME guard (folding in
      the sibling `fail-loud-on-proxied-loopback-backend`, still in backlog), not a
      parallel check; loopback detection reuses `core/security.ts`.
- [ ] Remote backend + `socks5` backend hop still works (guard keys on local only).
- [ ] Old single-`egress` configs/env are UNCHANGED (fetch hop inherits egress).
- [ ] An unbuildable FETCH proxy throws fail-loud BEFORE any I/O (never silent direct).
- [ ] The SSRF guard still wraps the egress-bound fetch and relaxes on the FETCH hop's
      egress, not the backend hop's.
- [ ] Tests extend `test/{egress,config,fetch,search}.test.ts` over the matrix above.
- [ ] README "Where does anonymity live?" documents the local-SearXNG + proxied-fetch
      topology as first-class, with a concrete `~/.config/webveil/config.json` example
      using `socks5h://127.0.0.1:1080` (prefer socks5h for remote DNS).
- [ ] An ADR records the per-hop egress decision; the finding is updated.
- [ ] A changeset (semver minor; additive, backward compatible).

## Blocked by

- None. Folds in the still-backlogged `fail-loud-on-proxied-loopback-backend` (extends
  its single guard for loopback TCP rather than adding a parallel check).

## Prompt

> Implement per-hop egress in webveil: an optional `Config.fetchEgress` that defaults to
> inheriting `egress`. `egress` governs the backend hop (search.ts, unchanged);
> `fetchEgress ?? egress` governs the fetch hop (fetch.ts / distilly / SSRF). Keep the
> fail-loud guard `assertEgressAllowsBaseUrl` scoped to the BACKEND hop and EXTEND it to
> loopback-TCP baseUrls (reuse `core/security.ts` loopback classification), folding in the
> sibling `fail-loud-on-proxied-loopback-backend`. Add `WEBVEIL_FETCH_EGRESS` /
> `WEBVEIL_FETCH_EGRESS_URL`. Reuse `buildDispatcher`/`createEgressFetch`/`guardEgressFetch`
> by handing them a config whose `.egress` is the resolved fetch-hop egress (a small
> `fetchEgressConfig(cfg)` helper). Tests + README + ADR + changeset per the criteria.
