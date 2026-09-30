---
'webveil': minor
'pi-webveil': minor
---

The default engine chain is now `["mwmbl", "marginalia"]`: Mwmbl's keyless public API first, then Marginalia, from two code recipes bundled in the webveil package (`recipes/mwmbl.mjs` and a refreshed `recipes/marginalia.mjs`, copies of searchcast's examples at commit `7b0dbde7daf7b50cf99f6b7846b75e34db18602f`). Marginalia's keyless API alone left a fresh install unable to search while it was down. Search works right after `npm install -g webveil` or `pi install npm:pi-webveil` again.

- **Still only a default.** It is used only when you configure no `searchcast.engines`, `recipes` or `codeRecipes`; any of them replaces it entirely, as before. No trust rule changes: a project `webveil.json` still cannot add code recipes.
- **More quota.** Set `MWMBL_API_KEY` (and `MARGINALIA_API_KEY`) for a personal key; without one, Mwmbl's quota is per IP address, shared by everyone on a Tor exit or VPN.
- **The README says what recipes add**, near the top: a site's search as an engine, code recipes for JavaScript result flows and challenges, a chain that falls through, a real browser as the last fallback, and a recipe set in one pinned command (`webveil install-recipes <url> --sha256 <hex>`).
- **`webveil doctor`** adds a `defaultChain` notice (not a problem) while the default chain is in use, pointing to recipes.
- The default chain's state starts one fresh partition (its identity key hashes the new chain); `webveil state clear --all` removes the old one.
