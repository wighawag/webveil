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
