---
'webveil': minor
---

Require `serpcast` `^0.2.0` and add the `serpcast.decoyGuard` config key (env `WEBVEIL_SERPCAST_DECOY_GUARD`, comma-separated): the engines it names (Bing, typically) have their answers checked for decoys, pages of results unrelated to the query, which then count as a `decoy` failure and hand over to the next engine, with no cooldown. serpcast 0.2 also reuses connections within an engine's session (per identity, never across), so repeated searches on the same engine are faster; `web_fetch` over the serpcast transport now closes its per-fetch session when the fetch settles.
