---
'webveil': patch
'pi-webveil': patch
---

`MARGINALIA_API_KEY` now helps: with it set, the bundled Marginalia recipe calls Marginalia's current API (`api2.marginalia-search.com`) with the key in an `API-Key` header, so the key never appears in a URL or an error message. Without a key it still uses the older URL-keyed API with the shared `public` key. The recipe is a refreshed copy of searchcast's `examples/recipes/marginalia.mjs` at commit `701584826ee5d50177c8df667329f27e949fd4aa`, and webveil now depends on `searchcast` `^0.3.0`, whose code recipes can add author headers to a `fetch` request. The README says what each key does: Mwmbl's goes in its query, Marginalia's selects its current API.
