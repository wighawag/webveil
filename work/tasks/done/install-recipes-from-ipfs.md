---
title: webveil install-recipes ipfs://<cid>[/path], through the configured egress
slug: install-recipes-from-ipfs
blockedBy: []
covers: []
---

## What to build

searchcast's `install-recipes` gains `ipfs://<cid>[/<path>]` sources (spec `ipfs-recipe-install` in wighawag/searchcast): fetched from trustless gateways over HTTPS, verified block by block against the CID, `--sha256` optional for IPFS. Adopt it once that searchcast minor is on npm:

- Depend on that searchcast version (add it to `minimumReleaseAgeExclude` as before).
- `webveil install-recipes ipfs://...` passes through to searchcast's installer with webveil's egress as the proxy (`--egress`, as for URLs today), `--sha256` optional for IPFS sources, `--ipfs-gateway <url>` repeatable.
- Config: `searchcast.ipfsGateways` (global config or env `WEBVEIL_SEARCHCAST_IPFS_GATEWAYS`; decide whether a project `webveil.json` may set it: it decides only where verified bytes come from, but it is a network destination; follow the trust rules for egress-related settings and record the decision).
- `webveil recipes` and `doctor` show the `ipfs://` source of a set.
- README: installing a recipe set from IPFS (one line), and where the gateways are configured.
- Tests offline (a local fake gateway, as searchcast's tests do; the egress is used).
- Changesets: `webveil` minor and `pi-webveil` minor.

## Acceptance criteria

- [ ] `webveil install-recipes ipfs://...` installs through the egress, verified, with and without `--sha256` (tested offline).
- [ ] Gateways configurable under the trust rules (tested); docs updated; the gate is green.

## Blocked by

- External: searchcast's `install-recipes-from-ipfs` released on npm (the conductor dispatches this after it).

## Prompt

Goal: one command installs a recipe set by CID, anonymously when the egress is Tor. Read `packages/webveil/src/setup.ts` (install-recipes) and the trust layer. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

> FORWARD-NOTE (conductor, 2026-10-01): the searchcast release this task waits for is out: `searchcast@0.4.0` (npm, with provenance). Depend on `^0.4.0` and add `searchcast@0.4.0` to `minimumReleaseAgeExclude`. It adds four pure-JS dependencies (`multiformats`, `@ipld/car`, `@ipld/dag-pb`, `ipfs-unixfs` and their small transitive set); if `minimumReleaseAge` blocks one of them, exclude that exact `name@version` only, never lower the global age, and record it. In `searchcast/install`, `installRecipes` takes `ipfs://` sources, an optional `sha256` for them and `ipfsGateways`; `RecipeSetSource` gains `cid` and `gateway`, and its `sha256` is now OPTIONAL (absent for an IPFS directory), so check every webveil reader of `.source.json` (`recipes`, `doctor`) for that. `DEFAULT_IPFS_GATEWAYS` is exported. searchcast refuses `ipfsGateways` for a non-IPFS source, so pass gateways (from config) only for `ipfs://` sources. Keep the existing explicit-route rule for downloads under a proxy egress (`--egress` / `--proxy` / `--direct`) unchanged for `ipfs://` sources. Make NO live network request in this build: public IPFS gateways rate-limit this machine's shared IP; the conductor runs the live check.

## Rules for this build

- Versions move only through `.changeset/*.md`; never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: SSRF guard on every hop, trust layers, per-identity state, egress on every hop, strict impersonation, no runtime download.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.

## Decisions

These are recorded in code: the header of `packages/webveil/src/setup.ts` and the `SearchcastConfig` notes in `packages/webveil/src/core/config.ts`.

1. **A project `webveil.json` may set `searchcast.ipfsGateways`.** It is treated like the other network settings (`egress`, a SearXNG `baseUrl`, `browser.endpoint`), not as an executable setting. Every block is checked against the CID you typed, so a gateway only decides where the verified bytes come from, not what gets installed. The progress line names the project file when it set them. The alternative was global config and env only.
2. **`ipfsGateways` is the one `searchcast` key left out of the search identity.** No search uses it, so setting it shouldn't start a fresh identity with new engine sessions. The README sentence saying "every key of the `searchcast` section is part of the identity" now names this exception.
3. **Configured gateways replace searchcast's defaults instead of adding to them.** To keep the defaults, list them too. The env form splits on commas, like `WEBVEIL_SEARCHCAST_DECOY_GUARD`.
4. **One user-visible change: a URL or file without `--sha256` now fails with exit 2 instead of 1.** The schema had to make `--sha256` optional, so webveil now checks it itself as `SHA256_REQUIRED` (exit 2, before the config or install code is loaded). Before, it was incur's `VALIDATION_ERROR` (exit 1). The changeset says so.
5. **One narrow edge case.** For an `ipfs://` source without `--ipfs-gateway`, the config is read for the gateways even when `--proxy` or `--direct` is given. In a folder whose config doesn't parse, only that case now fails; passing `--ipfs-gateway` avoids it.

The working tree holds only this task's changes.
