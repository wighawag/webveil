---
'webveil': minor
'pi-webveil': minor
---

The default engine chain is now `["mwmbl", "marginalia", "wiby"]`: when Mwmbl and Marginalia both fail (their per-IP quotas run out fast, worst of all over Tor, where an exit's quota is shared with everyone on it), the chain falls through to [Wiby](https://wiby.me), a small independent index of the hobbyist and old-style web, through its documented keyless JSON API (`https://wiby.me/json/`). The new code recipe, `recipes/wiby.mjs`, ships in the webveil package and is webveil's own (searchcast has no Wiby example); its header records the documents and terms it was written from.

- **Wiby's terms** ask for a link to wiby.me with the results, so every Wiby result's snippet ends with `(via Wiby, https://wiby.me/)`. Wiby publishes no rate limit and no licence for its results; an HTTP 429 or 503 cools the engine down, as for the others.
- **Wikipedia is not in the chain.** The Wikimedia API Usage Guidelines require following its User-Agent policy, which tells automated clients not to copy a browser's User-Agent, and webveil's strict browser impersonation (which stays as it is) does exactly that.
- **Still only a default.** It is used only when you configure no `searchcast.engines`, `recipes` or `codeRecipes`; any of them replaces it entirely, as before. No trust rule changes: a project `webveil.json` still cannot add code recipes.
- **`webveil doctor`**'s `defaultChain` notice names the three engines.
- The default chain's state starts one fresh partition (its identity key hashes the new chain); `webveil state clear --all` removes the old one.
