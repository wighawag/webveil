---
'webveil': minor
'pi-webveil': minor
---

The default backend is searchcast with a bundled Marginalia chain; set `backend: "searxng"` for the previous default. `npm install -g webveil` (or `pi install npm:pi-webveil`) is now the whole setup: search works with no service to run, no account and nothing else to install, still on `direct` egress.

- **The default chain.** When you configure no `searchcast.engines`, `recipes` or `codeRecipes`, the chain is `["marginalia"]`, from a code recipe shipped in the webveil package (`recipes/marginalia.mjs`, a copy of searchcast's example). It queries the Marginalia Search API, which is meant for programs, with the shared `public` key, which is rate limited for everyone who uses it: for regular use ask Marginalia for a free personal key (non-commercial) and set `MARGINALIA_API_KEY`. Its results are provided under CC-BY-NC-SA 4.0. Any engines, recipes or code recipes you configure replace the default chain entirely.
- **No trust rule changes.** The bundled recipe is trusted because it ships in the package; a project `webveil.json` still cannot add code recipes.
- **`web_fetch` now defaults to the impersonated transport** (`fetchTransport` follows the backend). Where libcurl-impersonate is not available, search and fetch fail with the fix (`webveil install-libcurl`, or `"fetchTransport": "plain"` for fetch), never a silent fallback to Node's TLS fingerprint.
- **Upgrading from the SearXNG default.** webveil does not probe for a local SearXNG. While the backend is the built-in default, a failed search and `webveil doctor` (a `defaultBackend` notice) say that the default changed and that `"backend": "searxng"` restores it; `baseUrl` still defaults to `http://127.0.0.1:8080`.
- **`webveil state clear`** in a folder with no searchcast settings now clears the default chain's identity instead of refusing.
