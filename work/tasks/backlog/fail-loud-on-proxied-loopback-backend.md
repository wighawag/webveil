---
title: Fail loud when egress is http/socks5 but the backend baseUrl is loopback (false-confidence guard)
slug: fail-loud-on-proxied-loopback-backend
blockedBy: []
covers: []
---

## What to build

A guard that REFUSES the false-confidence egress combo: a non-`direct` egress
(`http` | `socks5`) configured together with a **loopback `baseUrl`** (127.0.0.0/8, `::1`,
`localhost`). This combination is almost always a misconfiguration that gives the user fake
anonymity: webveil would proxy a pointless localhost call while the backend (e.g. a local
SearXNG) crawls the public web from the user's REAL IP, outside webveil's egress. Per the
anonymity-boundary model (`work/notes/findings/webveil-anonymity-boundary.md`), the proxy
belongs on the hop that reaches the internet; for a local backend that is the backend's job
(`outgoing.proxies`), not webveil's.

Decision (recorded): **option (a) hard fail** \u2014 throw an `EgressError` (the existing
fail-loud type) at config/egress resolution with a message that explains the fix: either
set `egress=direct` and proxy the backend itself, or point `baseUrl` at a remote backend.
Chosen over warn-and-proceed or auto-bypass to avoid false confidence (webveil's standing
"never silently do the wrong anonymity thing" stance).

Scope/precision:
- The guard keys on **loopback `baseUrl` specifically**, NOT "backend is searxng". A
  REMOTE SearXNG (or any remote backend) over `socks5` is LEGITIMATE and must keep working.
- It governs the **backend `baseUrl` hop only**. `web_fetch` targets are arbitrary URLs
  governed by the SSRF guard, not this check \u2014 do not block `web_fetch` of a loopback URL
  here (that is SSRF's concern and has its own proxy-relaxation rules).
- Loopback detection should cover IPv4 `127.0.0.0/8`, IPv6 `::1`, and the hostname
  `localhost` (reuse the SSRF guard's private/loopback classification in `core/security.ts`
  rather than re-implementing ranges).

## Acceptance criteria

- [ ] With `egress` = `http` or `socks5` AND `baseUrl` resolving to a loopback host, webveil
      throws `EgressError` (fail-loud) with an actionable message; it never proceeds to
      proxy a localhost backend.
- [ ] With `egress=direct` + loopback `baseUrl` (the normal local-SearXNG case): allowed.
- [ ] With `egress=socks5` + a NON-loopback (remote) `baseUrl`: allowed (remote backend
      over SOCKS stays valid).
- [ ] `web_fetch` behaviour is unchanged (the guard does not touch fetch targets; SSRF
      still owns those).
- [ ] Loopback detection reuses `core/security.ts` classification (127.0.0.0/8, ::1,
      localhost), not a fresh range list.
- [ ] Tests cover all four quadrants (direct/proxy x loopback/remote) plus the
      `web_fetch`-unaffected case.

## Blocked by

- None — can start immediately. (Builds on the shipped egress + security modules.)

## Prompt

> Add a fail-loud guard to webveil's egress for the false-confidence combo: a non-direct
> egress (http/socks5) with a loopback backend `baseUrl`. Read
> `work/notes/findings/webveil-anonymity-boundary.md` (the decision + rationale, option (a)
> hard fail) and `work/notes/findings/searxng-install-topology.md` for context. The egress
> seam is `core/egress.ts`; loopback/private classification already exists in
> `core/security.ts` (reuse `isPrivateIp` / its loopback logic, plus handle the `localhost`
> hostname). Config resolution is `core/config.ts`.
>
> The check: when the resolved config has `egress.mode` in {http, socks5} AND `baseUrl`'s
> host is loopback (127.0.0.0/8, ::1, localhost), throw `EgressError` with a message that
> tells the user to either set egress=direct and proxy the backend itself (e.g. SearXNG's
> outgoing.proxies) or use a remote backend. Decide WHERE the check lives (likely where
> config + egress are combined, before building the dispatcher / making the backend call) so
> it fires once, early, and clearly. A REMOTE baseUrl over socks5 must remain valid; key on
> loopback only. Do NOT affect `web_fetch` targets (SSRF owns those).
>
> Test all four quadrants (direct/proxy x loopback/remote) and that web_fetch is unaffected.
> Done = the guard throws on the bad combo, allows the three good combos, reuses the
> security loopback classification, with a green verify gate. Record any non-obvious
> in-scope decision (e.g. exact loopback host set, where the check is wired) in the done
> record.
