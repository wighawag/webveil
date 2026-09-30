---
title: Default chain Mwmbl then Marginalia on searchcast 0.3, and a README that says plainly how much more webveil does with recipes
slug: default-chain-mwmbl
spec: searchcast-backend
blockedBy: [default-backend-searchcast]
covers: [1, 6]
---

## What to build

Live check 2026-09-30 (conductor): Marginalia's keyless old API, the only engine of webveil 0.11's default chain, answered 504 after 60 s all evening (its new API needs a key, which the owner does not want as a default), so a fresh webveil 0.11 cannot search. Mwmbl's documented v2 API answered 200 in 0.16 s with no key. Owner decision (2026-09-30): the default chain becomes Mwmbl, then Marginalia.

- Stay on `searchcast` `^0.2.0` (conductor update: the examples are not in any published package, and author headers were re-scoped and are not needed here).
- Bundle `recipes/mwmbl.mjs` and refresh `recipes/marginalia.mjs` as copies of searchcast's `examples/recipes/mwmbl.mjs` and `marginalia.mjs` from searchcast's `main` at the commit that added the Mwmbl example (https://github.com/wighawag/searchcast, record the commit in each header). The default chain (used only when the user configures no engines, recipes or code recipes, as today) is `["mwmbl", "marginalia"]`.
- README, prominently (near the top, not only in the reference): what the default gives (two small, independent, non-commercial indexes through their public keyless APIs; per-IP quotas, which a Tor exit or VPN shares with everyone on it; CC BY-NC-SA results) and that **webveil is much more capable with recipes**: recipes turn any site's search into an engine, a code recipe can handle a site's JavaScript result flow or challenges, the engine chain falls through, a real browser is the last fallback (`@searchcast/browser`), and a recipe set installs in one pinned command (`webveil install-recipes <url> --sha256 <hex>`). Show the shape of a declarative recipe and of a code recipe (placeholders only, e.g. `example.test`), link searchcast's recipe docs, and say how to get keys for the two default engines for more quota (`MWMBL_API_KEY`, `MARGINALIA_API_KEY`). No other engine named.
- pi-webveil README: the same short message (works after install; far better with recipes; where to start).
- `webveil doctor`: when the default chain is in use, one informational line saying so and pointing to recipes (not a problem, doctor stays healthy).
- Tests: the fresh-config default chain is `["mwmbl", "marginalia"]` with both files in the tarball; a search falls through from a failing Mwmbl fake to a Marginalia fake (no network).
- Changesets: `webveil` minor and `pi-webveil` minor.

## Acceptance criteria

- [ ] Both bundled recipes are copies of searchcast's examples (commit recorded) and ship in the tarball.
- [ ] Default chain `["mwmbl", "marginalia"]`, replaced entirely by any user engine setting (tested); no trust rule relaxed.
- [ ] README and pi-webveil README state the default's limits and, prominently, what recipes add, with placeholder examples; doctor's informational line.
- [ ] No network in tests; the gate is green.

## Blocked by

- default-backend-searchcast
- External: searchcast's `example-mwmbl-recipe` merged (the conductor dispatches this task after it).

## Prompt

Goal: webveil works right after one install, and a new user immediately learns that the default is a floor, not the product. Read the README's quick start and the searchcast backend's default-chain code (`default-backend-searchcast`'s decisions in its done record).

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Rules for this build (all tasks of spec `searchcast-backend`)

- Versions move only through `.changeset/*.md` (minor for `webveil`, and for `pi-webveil` when its published content changes); never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: the SSRF guard (every redirect, every hop), the trust layers (project `webveil.json` cannot set code, library paths, programs to run, or egress-weakening settings), per-identity state, egress on every hop, strict impersonation, no runtime download. Gate-3 checks each is still tested.
- Public repo: no real search engine named in code, tests, examples or docs (placeholders), except the Marginalia and Mwmbl APIs the owner approved.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No live network calls in tests.
