---
title: webveil install-recipes ipfs:// suggests webveil commands (with the route) when the source is not a set
slug: ipfs-install-suggestions
blockedBy: []
covers: []
---

## What to build

searchcast 0.4.1 refuses an `ipfs://` directory that cannot be a recipe set (for example a release folder's root) after one small listing request, and its `InstallError` message suggests `searchcast install-recipes ipfs://<cid>/<path>/<entry>`. webveil passes that message through unchanged, so a webveil user is told to run searchcast DIRECTLY, which skips webveil's egress: the request would go out direct instead of through their Tor or proxy. searchcast 0.4.2 (task `ipfs-suggestions-as-data` in wighawag/searchcast) adds `error.suggestions: {source, kind: 'archive' | 'set-directory', sha256?}[]` for exactly this.

- Depend on `searchcast ^0.4.2` (lockfile updated; add `searchcast@0.4.2` to `minimumReleaseAgeExclude`, nothing else; update the tests that pin the version).
- In `installRecipes` (`packages/webveil/src/setup.ts`), when searchcast's `InstallError` carries `suggestions`, rethrow an error whose message says the source is not a recipe set and suggests, one per suggestion, `webveil install-recipes <source>` plus: `--sha256 <hex>` when the suggestion has one; the route flag the user used (`--egress` or `--direct` as typed; for `--proxy`, write `--proxy <url>` and NEVER the URL itself, which may carry credentials, per this file's existing rule); `--ipfs-gateway <url>` repeated as typed when given (gateway base URLs carry no credentials: searchcast refuses them); `--name` and `--force` as typed. Keep searchcast's listing of the entries (the part of its message before "Try:", or rebuild it); never print the string "searchcast install-recipes" in the webveil message. Exit code unchanged.
- Without `suggestions` (any other error), behaviour is unchanged.
- Tests offline: a fake gateway serving a release-folder layout (archive, `.sha256`, `README.txt`, set subdirectory) through the test SOCKS proxy, as the existing IPFS tests do: with `--egress`, `--proxy` (asserting the URL is absent), `--direct` and `--sha256`, the message names `webveil install-recipes` commands with the right flags; installing one suggested command works.
- Changesets: `webveil` patch and `pi-webveil` patch.

## Acceptance criteria

- [ ] The not-a-set refusal suggests `webveil install-recipes ...` commands carrying the user's route (`--proxy <url>` as a placeholder, never the URL) and `--sha256` on the archive only; no "searchcast install-recipes" in the message (tested offline).
- [ ] Other errors unchanged; searchcast `^0.4.2`; the gate is green.

## Blocked by

- External: searchcast 0.4.2 (`ipfs-suggestions-as-data`) released on npm; the conductor dispatches this after it.

## Prompt

Goal: webveil never tells its user to step outside webveil's egress. Read `packages/webveil/src/setup.ts` (install-recipes, the route rules and the credential rule in its header) and the existing IPFS tests in `test/setup.test.ts`. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Versions move only through `.changeset/*.md`; never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: SSRF guard on every hop, trust layers, per-identity state, egress on every hop, strict impersonation, no runtime download. No secret (a proxy URL's credentials included) in any message.
- Make NO live network request.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs. Public repo: no real search engine named except Mwmbl and Marginalia.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
