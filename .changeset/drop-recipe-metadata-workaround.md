---
'webveil': patch
'pi-webveil': patch
---

Require `searchcast` `^0.5.0` and `@searchcast/recipe` `^0.1.1`, whose `loadRecipes` skips an installed recipe set's `manifest.json` and `.source.json`. webveil no longer detects a set itself to skip them: every `searchcast.recipes` directory now loads its `*.json` files except hidden ones and `manifest.json`, as `searchcast serve --recipes <dir>` does, so a set copied anywhere (without `.source.json`) loads too. Installed sets load as before.
