---
title: Core foundation — config resolution, egress dispatcher + egress-bound fetch, http helper, backend types
slug: core-foundation-config-egress-http
prd: webveil-tool-and-pi-extension
blockedBy: []
covers: [4, 9, 10]
---

## What to build

The shared substrate every other webveil module sits on, as one thin vertical slice:
resolve per-folder config, build the egress dispatcher, expose the two egress artifacts
(the proxied `http` helper for backends AND the egress-bound `fetch` for distilly), and
declare the `Backend` interface. End-to-end demoable: from a cwd with a `.pi/webveil.json`
you can resolve a config, build a dispatcher for its egress mode, and obtain both an
`http` helper and a `fetch` bound to that dispatcher; a misconfigured proxy fails loud.

- **config** — resolve `{ backend, baseUrl, apiKey?, egress, fetchSize }` with precedence
  env > nearest `.pi/webveil.json` (walking up from cwd) > global
  `~/.pi/agent/webveil.json` > defaults (`searxng`, `http://127.0.0.1:8080`,
  `egress: direct`). Layer over incur's config-file feature.
- **egress** — `buildDispatcher(cfg)` returning an undici Dispatcher: `direct`
  (undefined), `http` (undici `ProxyAgent`, no extra dep), `socks5` (via
  `socks-proxy-agent`, a PLAIN dependency). FAIL LOUD if a socks dispatcher cannot be
  built — never return a direct dispatcher as a fallback. Also expose an egress-bound
  WHATWG `fetch` built with undici's `fetch` closed over the dispatcher
  (`(input, init) => undiciFetch(input, { ...init, dispatcher })`); same fail-loud
  guarantee (it throws if the proxy can't be built, never goes un-proxied). This is the
  `fetch` injected into `distilly/fetch` by a later task.
- **http** — one `fetchJson`/`fetchText` helper applying the dispatcher + timeout +
  abort. This is the `http` handed to backends (distinct from the egress `fetch`; both
  bound to the SAME dispatcher).
- **backend types** — the `Backend` interface: `search`, optional `fetch`, each given the
  proxied `http` helper, plus the shared `SearchResult` / `FetchResult` shapes (move from
  the placeholder `src/index.ts`).

## Acceptance criteria

- [ ] `buildDispatcher` returns the correct dispatcher per mode (`direct` → undefined,
      `http` → ProxyAgent, `socks5` → socks dispatcher).
- [ ] `socks5` with the socks dep missing/unbuildable FAILS LOUD (assert the thrown
      error); it never returns a direct dispatcher.
- [ ] The egress-bound `fetch` performs requests through the dispatcher; built on an
      unbuildable proxy it THROWS rather than fetching un-proxied.
- [ ] Config precedence resolves env > project `.pi/webveil.json` > global > defaults; the
      per-folder walk works from a nested cwd.
- [ ] The `Backend` interface + result types are exported and consumed by no backend yet
      (foundation only).
- [ ] Tests cover the new behaviour (mirror the repo's existing vitest style).
- [ ] Config/global-file tests ISOLATE the home/global path (point the global
      `~/.pi/agent/webveil.json` lookup at a temp dir via the relevant env/knob) AND
      assert the real `~/.pi/agent/` is UNTOUCHED after the run.

## Blocked by

- None — can start immediately.

## Prompt

> Build webveil's core foundation modules: per-folder config resolution, the egress seam,
> the http helper, and the backend type contract. webveil is an anonymous-capable,
> self-hosted web search/fetch tool; this task lays the substrate every other module
> imports. Read `CONTEXT.md` (the seam definitions) and
> `work/prds/ready/webveil-tool-and-pi-extension.md` (Implementation Decisions).
>
> Domain vocabulary: **egress seam** (`direct` | `http` | `socks5/Tor`), **config seam**
> (per-folder `.pi/webveil.json` > global > env > defaults), **backend seam** (the
> `Backend` interface, handed a proxied `http` helper so it cannot bypass egress).
>
> CRITICAL anonymity invariants (see `docs/adr/0001`): egress is fail-loud — a configured
> proxy that cannot be built must THROW, never silently fall back to un-proxied. Expose
> BOTH a proxied `http` helper (for backends) AND an egress-bound WHATWG `fetch` (undici
> `fetch` over the same dispatcher) — the latter is what a later task injects into
> `distilly/fetch`, so distilly never has egress of its own.
>
> Seams to test at: `buildDispatcher` per mode (incl. the socks fail-loud), the
> egress-bound fetch (routes through the dispatcher; throws on unbuildable proxy), and
> config precedence + the per-folder walk. Isolate the global-config path to a temp dir in
> tests and assert the real home dir is untouched.
>
> Done = config + egress (dispatcher + egress fetch) + http helper + `Backend` types land
> with passing tests, and the verify gate (`pnpm format:check && pnpm build && pnpm test`)
> is green. Keep modules small (see the LOC targets in `CONTEXT.md`).
>
> FIRST, check this task against current reality (ADRs, sibling done tasks) before
> building. RECORD any non-obvious in-scope decision (e.g. exact fail-loud error shape) per
> the template guidance.
