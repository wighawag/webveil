---
title: ADR 0004 still says web_fetch stays on the undici path
slug: adr-0004-web-fetch-consequence-superseded
---

Observed 2026-09-29 (task `web-fetch-via-serpcast-transport`). The last consequence of `docs/adr/0004-engine-layer-in-serpcast-webveil-injects-policy.md` says "`web_fetch` stays on the undici path with its SSRF guard; moving it to the impersonated transport is a separate decision". That decision has now been taken (owner, 2026-09-29: `fetchTransport`, defaulting to `serpcast` with the serpcast backend; see `packages/webveil/src/core/fetch-transport.ts`), but the ADR was not amended by that task. A human may want to amend the consequence or add an ADR for it.
