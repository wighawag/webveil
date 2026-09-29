---
'webveil': minor
---

Require `serpcast` `^0.5.0` (and `serpcast-recipe` `^0.2.0`). Recipes may now declare `decoyProne: true` and are then checked for decoys without being listed in `serpcast.decoyGuard`; code recipes can POST (`ctx.http.post`, `ctx.http.postJson`) and set cookies (`ctx.cookies`). A recipe set installed with `npx serpcast install-recipes <archive> --sha256 <hex>` is named `set:<name>` (the whole set) or `set:<name>/<file>` in `serpcast.recipes` and `serpcast.codeRecipes` (and in `WEBVEIL_SERPCAST_CODE_RECIPES`), looked up in `$XDG_DATA_HOME/serpcast/recipes/`, never the cwd; `codeRecipes` stays refused from a project `webveil.json` whatever its form. A set directory's `manifest.json` and `.source.json` are no longer loaded as recipes. The README gains an "Installing recipes" section and a complete NixOS section (recipes, home-manager config, a full Tor example).
