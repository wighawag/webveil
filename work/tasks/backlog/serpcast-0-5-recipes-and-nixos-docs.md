---
title: Adopt serpcast 0.5 (decoyProne recipes, POST, recipe cookies, install-recipes) and complete the NixOS and recipe-install docs
slug: serpcast-0-5-recipes-and-nixos-docs
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

serpcast 0.5.0 (released 2026-09-29) adds, since 0.3: recipes can declare `decoyProne: true` (guarded without `decoyGuard`); code recipes can POST (`ctx.http.post`/`postJson`, Chrome's exact POST headers and CORS preflights); code recipes can set cookies (`ctx.cookies`, `document.cookie` semantics); and `serpcast install-recipes <url|path> --sha256 <hex>` installs a checksum-pinned recipe set into `$XDG_DATA_HOME/serpcast/recipes/<set>/` (`serpcast recipes list` shows them; `recipesDir()` is exported).

1. **Dependency:** serpcast `^0.5.0` (lockfile, `minimumReleaseAgeExclude`), changeset (minor). Check nothing in webveil breaks.
2. **Installed recipe sets in webveil:** decide and record how webveil finds them. Recommended: `serpcast.codeRecipes` and `serpcast.recipes` accept installed set names as well as paths (for example an entry `set:<name>` resolved to `recipesDir()/<name>`), or document pointing `codeRecipes` at `~/.local/share/serpcast/recipes/<set>` (a `~/` path, which webveil's trust helper already resolves without the cwd). Whichever: the data directory is under the user's home, never the cwd, and code recipes stay trusted-layer only.
3. **README:**
   - `decoyGuard` is now optional for recipes that declare `decoyProne` (the guard line in examples becomes an override).
   - A "Installing recipes" subsection: `npx serpcast install-recipes <archive> --sha256 <hex>` (why the pin is required: recipes are code), how to point webveil at the installed set, `serpcast recipes list`, and that a private GitHub release asset is fetched with `gh release download` first.
   - Complete the **"On NixOS"** subsection (owner request: it must be enough to run webveil's serpcast backend on NixOS without the fleet repo): libcurl-impersonate (already there), installing recipes on NixOS (the `install-recipes` command works as is into `~/.local/share/serpcast/recipes/`; for a declarative setup, home-manager can place a pinned, extracted archive with `xdg.dataFile."serpcast/recipes/<set>".source = pkgs.fetchzip { url = ...; hash = ...; }` for a public archive, or a local path for a private one; verify the fetchzip form evaluates, or give the shape without claiming it was run), where the global config lives on NixOS/home-manager (`xdg.configFile."webveil/config.json".text = builtins.toJSON {...}`), and a complete minimal example config for the serpcast backend with Tor egress, recipes and `web_fetch` over serpcast. Keep it short and verified where possible; say what was verified.

## Acceptance criteria

- [ ] serpcast `^0.5.0`; all existing tests pass; changeset.
- [ ] The chosen way to reference an installed set works end to end in a test (a set installed with serpcast's install into a temp `XDG_DATA_HOME`, then a search through webveil loading a code recipe from it via the fake serpcast or a fake transport), and a project `webveil.json` still cannot name code recipes.
- [ ] README: decoyProne note, "Installing recipes", and the completed "On NixOS" section as above; no em dashes; single-line paragraphs.

## Blocked by

- None, can start immediately.

## Prompt

FIRST, check this task against current reality (serpcast 0.5.0's README and exports). RECORD non-obvious decisions.
