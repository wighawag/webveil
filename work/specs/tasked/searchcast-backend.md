---
title: webveil moves from serpcast to searchcast, and searchcast becomes the default backend
slug: searchcast-backend
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` and the code; remaining work: the tasks under `work/tasks/`. Tasked on 2026-09-30 into `move-to-searchcast-packages`, `rename-serpcast-spellings`, `default-backend-searchcast` (strictly in that order).

## Problem Statement

serpcast was renamed and merged into searchcast (searchcast's ADR 0005): `serpcast` is now `searchcast` 0.2.0, `serpcast-recipe` is `@searchcast/recipe` 0.1.0, and the browser runner webveil uses as an optional peer (`searchcast` 0.1.x) is `@searchcast/browser` 0.1.0. `searchcast` now brings the pinned libcurl-impersonate itself on supported platforms (optional platform packages), so the HTTP backend needs no separate install. webveil still depends on the old names, speaks of `serpcast` in its config, env and docs, and defaults to a local SearXNG that most users do not run, so it fails out of the box.

## Solution

webveil depends on the new packages and speaks of `searchcast` everywhere (backend `searchcast`, config section `searchcast.*`, `fetchTransport: "searchcast"`, `WEBVEIL_SEARCHCAST_*`), accepting the old `serpcast` spellings for one release with a clear warning. The default backend becomes `searchcast` with a bundled, terms-compliant engine chain (the Marginalia API example), so `webveil` and `pi-webveil` work after one install with nothing else to run. Then a minor release of both packages (still below 1.0).

## User Stories

1. As a webveil user, I want `npm install -g webveil` (or installing pi-webveil in pi) to be the whole setup on Linux, macOS and Windows x64/arm64, so that search works with nothing else to install or run.
2. As a webveil user with a `serpcast` config, I want it to keep working for one release with a warning naming the new spelling, so that I can upgrade before I edit.
3. As a webveil user who relied on the implicit SearXNG default, I want a clear message telling me to set `backend: "searxng"`.
4. As a privacy-minded user, I want every security property unchanged: the SSRF guard on every hop, the trust rules (what a project `webveil.json` may not set), per-identity state, egress on every hop, strict impersonation, no runtime download.
5. As a user of the browser fallback, I want to install `@searchcast/browser` (instead of `searchcast`) next to webveil and keep the same config.
6. As the owner, I want the public repo to name no search engine except the owner-approved Marginalia example.

## Decisions kept at the spec level

- Old spellings are accepted for one release (the next minor after this one removes them); both spellings set at once is an error, never a silent pick.
- The default chain is used only when the user configured no engines, recipes or code recipes; a user's own recipe set replaces it entirely.
- The public recipe set idea (stripped engine recipes in a public repo) was dropped by the owner (2026-09-30); private recipe sets are installed as before.

## Out of Scope

- webveil-private-recipes (its own repo).
- Removing the old spellings (next minor).
