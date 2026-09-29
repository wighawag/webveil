---
title: CI test workflow and a Changesets release workflow publishing webveil and pi-webveil via npm Trusted Publishing (OIDC)
slug: release-workflow-oidc
blockedBy: []
covers: []
---

## What to build

webveil has no GitHub Actions workflows at all: releases were run by hand (`pnpm release`), and nothing runs the verify gate on push or PR. The owner has registered npm trusted publishers for this repo's `release.yml` (2026-09-29). Mirror serpcast's setup (https://github.com/wighawag/serpcast: `.github/workflows/test.yml` and `.github/workflows/release.yml`, and its `release:ci` script):

- `test.yml`: on push to main and pull_request, Node 24, pnpm, `pnpm install --frozen-lockfile` then the same gate as `dorfl.json`'s `verify`.
- `release.yml` (this exact file name, the trusted publisher is bound to it): push to main + `workflow_dispatch`, non-cancelling concurrency, `contents`/`pull-requests`/`id-token: write`, Node 24 with the npm registry URL, `changesets/action@v1` with `publish: pnpm release:ci` and `version: pnpm changeset version`, `PNPM_CONFIG_PROVENANCE: true` (pnpm 11 ignores `publishConfig.provenance`; see serpcast's decision), no `NPM_TOKEN`.
- Root `release:ci` script: format check, build, `changeset publish`. Keep or retire the local `release` script, recording the choice (serpcast dropped its local publish path so every publish is OIDC with provenance).
- Check the install path works in CI: the root `preinstall` runs `npx only-allow pnpm` (a network call) and `build` uses `ldenv`; make sure both work on the runner or adjust, recording why.
- `.changeset/config.json` has `"access": "restricted"` while both packages set `publishConfig.access: public`; make them consistent (public), recording it.

The pending changesets already on main (from the serpcast backend tasks) will become the first Version Packages PR once this lands; do not add a changeset for this task.

## Acceptance criteria

- [ ] `test.yml` runs the verify gate on push and PR, and is green on this task's own PR.
- [ ] `release.yml` matches the description above (file name exactly `release.yml`), with no token secret.
- [ ] `release:ci` exists; `pnpm pack --dry-run` in each package shows only the intended files (dist, README, LICENSE, package.json, and whatever ships today).
- [ ] The `access` setting is consistent; README gains a short "Release" section like serpcast's.

## Blocked by

- None, can start immediately.

## Prompt

Goal: tokenless, provenance-stamped releases and a CI gate for webveil. Copy serpcast's workflows and adapt them to this workspace. FIRST, check this task against current reality. RECORD non-obvious decisions.
