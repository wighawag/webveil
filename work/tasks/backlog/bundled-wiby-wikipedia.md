---
title: Bundle Wiby and Wikipedia code recipes and add them to the default engine chain, from their documented APIs and terms
slug: bundled-wiby-wikipedia
blockedBy: []
covers: []
---

## What to build

webveil's default chain is `["mwmbl", "marginalia"]` (`DEFAULT_ENGINES` and `BUNDLED_RECIPES` in `packages/webveil/src/core/backends/searchcast.ts`, files in `packages/webveil/recipes/`). Both are small indexes with per-IP quotas, so the chain fails or comes back thin for many queries, worst of all over Tor, where an exit IP's quota is shared with everyone on that exit. The owner approved (2026-10-24) naming two more engines in this public repo, **Wiby** and **Wikipedia**, as bundled code recipes from their documented public APIs.

1. **Read each engine's own documentation and terms first, and record them** in the recipe's header, as `marginalia.mjs` does (URL, date read, the terms in short, rate limits, the licence of the results):
   - Wiby (https://wiby.me, its about page and its JSON API).
   - Wikipedia through the MediaWiki Action API search (`action=query&list=search`, or the REST search endpoint; decide and record) on `en.wikipedia.org`, and the Wikimedia API usage guidelines and User-Agent policy. IMPORTANT: that policy asks automated clients to send an identifying User-Agent, while searchcast impersonates a browser strictly (it does not change the User-Agent). Decide whether a request a browser page would make (`kind: 'fetch'` from the API's origin, as `marginalia.mjs` does) is within the policy. If it is not, or you cannot tell, DO NOT bundle the Wikipedia recipe: write it up in the PR and in an observation note, and ship Wiby alone. Never weaken strict impersonation to satisfy a policy.
   - Drop either engine whose terms forbid this use.
2. **The recipes:** `packages/webveil/recipes/wiby.mjs` and `wikipedia.mjs`, in the style of `mwmbl.mjs` and `marginalia.mjs`: through `ctx.http` only (the caller's egress and the SSRF guard apply), honouring `ctx.maxResults`, mapping to the standard result shape (title, url, snippet; strip HTML from Wikipedia's snippets), and failing with a clear error on an unexpected answer so the chain falls through. Wikipedia's results are encyclopedia pages: map each to its article URL.
3. **The default chain** becomes `["mwmbl", "marginalia", "wiby", "wikipedia"]` (Wikipedia last: it is not a general web index). Update `BUNDLED_RECIPES`, the `doctor` `defaultChain` notice text, the README ("The default engines, and what recipes add"), CONTEXT if it names the chain, and the tests that pin the chain. The default chain's identity changes, so its state starts one fresh partition: say so in the changeset.
4. **Tests (offline):** each recipe against captured or hand-built fixture answers (normal results, empty results, an error/unexpected body, `maxResults`), and the default chain resolving to the four bundled files in order. No network in tests.
5. Changesets: `webveil` minor and `pi-webveil` minor (the default chain changes).

## Acceptance criteria

- [ ] `wiby.mjs` (and `wikipedia.mjs` unless its terms or User-Agent policy rule it out, with the reason recorded) are bundled, documented with their terms, and tested offline.
- [ ] The default chain is `mwmbl, marginalia, wiby, wikipedia` (or without the dropped one), in code, docs and tests; the gate is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: the default chain answers, from engines that welcome automated use. Read `packages/webveil/recipes/*.mjs`, `packages/webveil/src/core/backends/searchcast.ts` (the default chain decisions) and searchcast's code recipe docs. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Versions move only through `.changeset/*.md`; never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: SSRF guard on every hop, trust layers, per-identity state, egress on every hop, strict impersonation, no runtime download.
- Public repo: name no real search engine except the owner-approved Mwmbl, Marginalia, Wiby and Wikipedia.
- Make NO live network request (the conductor runs the live check); reading documentation pages is fine.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
