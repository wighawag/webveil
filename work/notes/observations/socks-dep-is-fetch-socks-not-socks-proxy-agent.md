---
title: SOCKS egress dep is fetch-socks, not the spec'd socks-proxy-agent
slug: socks-dep-is-fetch-socks-not-socks-proxy-agent
---

## What was observed

The `core-foundation-config-egress-http` build (PR #1) implemented the socks5 egress
dispatcher with **`fetch-socks`** (`^1.3.3`), NOT the **`socks-proxy-agent`** dependency
pinned by the spec (the task body, `CONTEXT.md` Stack/egress seam, the PRD Implementation
Decisions, and `docs/adr/0001` all name `socks-proxy-agent` as a PLAIN dependency).

The deviation was NOT recorded by the build (no ADR, no `## Decisions` note in the done
record) — so it is a review finding per the task template ("RECORD non-obvious in-scope
decisions; an un-recorded in-scope decision is a review FINDING").

## Why the substitution is (probably) correct

The egress seam exposes an egress-bound WHATWG `fetch` = undici `fetch` closed over a
`{ dispatcher }` (docs/adr/0001). That requires the socks layer to produce an undici
**Dispatcher**. `fetch-socks`'s `socksDispatcher(...)` returns exactly that (an undici
Agent over a socks connector), composing cleanly with `undiciFetch(url, { dispatcher })`.
`socks-proxy-agent` produces a Node `http.Agent`, which does NOT plug into undici's
`fetch({ dispatcher })` seam. So the agent likely hit a real incompatibility and picked
the tool that fits the dispatcher-based design.

The fail-loud behaviour the spec demanded IS delivered and tested (socks5 with a
malformed / missing / wrong-scheme url throws `EgressError`; the egress fetch throws on an
unbuildable proxy rather than going un-proxied).

## Follow-up (spec reconciliation needed)

The code is fine; the SPEC DOCS now lie. Reconcile so the next reader/task is not misled:
- `CONTEXT.md` (Stack + egress seam): `socks-proxy-agent` → `fetch-socks`.
- `docs/adr/0001`: the "egress-bound fetch via undici { dispatcher }" consequence should
  name `fetch-socks` as the socks layer (and note WHY: it yields an undici Dispatcher).
- The tasked PRD is a launch snapshot (not maintained), so leave it; but the
  `readme-loc-and-publish-hygiene` task will document deps — it should list `fetch-socks`.

This is a doc-vs-code drift fix, not a code change. Consider a one-line ADR amendment
rather than a new ADR (the decision is small and follows from the existing dispatcher one).
