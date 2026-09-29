---
'webveil': minor
---

serpcast code recipes: private engines (challenge handling, sites with restrictive terms) plug in as JS module files.

- **`serpcast.codeRecipes`** lists code recipe modules or directories (every `*.js` and `*.mjs` inside), loaded with serpcast's `loadCodeRecipe` and usable in `serpcast.engines` like declarative recipes. Env form: `WEBVEIL_SERPCAST_CODE_RECIPES`, absolute or `~/` paths separated by the platform path delimiter (`:`, or `;` on Windows).
- **An executable setting**: loading a code recipe runs it, so `serpcast.codeRecipes` is refused from a project `webveil.json` (with the file and key named) before any module is imported, and accepted from the global config or env. A project config that sets only `serpcast.engines` keeps the global `codeRecipes` and can list those recipes in its engine order.
- Code and declarative recipes share one name space: a name used twice is an error.
