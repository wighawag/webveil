---
title: Docs match the SOCKS code (fetch-socks, every SOCKS scheme resolves DNS at the proxy)
slug: socks-docs-match-code
blockedBy: []
covers: []
---

## What to build

Two documentation fixes, no behaviour change. CONTEXT.md (egress seam and Stack sections) names `socks-proxy-agent`, but the code uses `fetch-socks` (an undici dispatcher, which is what the egress-bound `fetch` needs); correct it. And the egress accepts `socks5://`, `socks://` and `socks5h://` but treats them all the same, resolving host names at the proxy; say so plainly in the README's egress section and in CONTEXT.md, so a user who writes `socks5://` knows DNS does not resolve locally and a user who writes `socks5h://` knows it is not required. No changeset needed unless a published README changes (the package README, if it carries the same text: then a patch changeset).

## Acceptance criteria

- [ ] CONTEXT.md names `fetch-socks` and says why (undici dispatcher).
- [ ] README and CONTEXT state that all three SOCKS schemes resolve DNS at the proxy.
- [ ] No other text changes; no em dashes in edited text.

## Blocked by

- None, can start immediately.

## Prompt

Origin: observations `socks-dep-is-fetch-socks-not-socks-proxy-agent` and `socks5h-scheme-accepted-but-ignored` (it offered a doc-only fix; take that one), and finding `socks5-egress-behaviour-in-webveil`. Delete both observation notes in this change once resolved.

FIRST, check this task against current reality (launch snapshot; may have drifted).
