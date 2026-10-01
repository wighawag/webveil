---
title: Browser engines are named browser:<recipe>; searchcast:<recipe> still works for one release with a warning
slug: browser-engine-prefix
spec: searchcast-backend
blockedBy: [engine-neutral-no-em-dashes]
covers: [2]
---

## What to build

Observation `work/notes/observations/2026-09-30-browser-engine-prefix-reads-as-backend-name.md`: a browser engine is named `searchcast:<recipe>` in `searchcast.engines` (`BROWSER` in `packages/webveil/src/core/backends/searchcast.ts`). Since the backend, its section and every HTTP engine are "searchcast" too, the prefix no longer says "browser". Make `browser:<recipe>` the spelling (and the endpoint form, if there is one, likewise), and keep accepting `searchcast:<recipe>` for one release with ONE warning per spelling through the same deprecation channel as the other old spellings (`spellings.ts`: CLI stderr, pi-webveil, doctor's `deprecations`, `onWarning`). Both forms naming the same recipe in one chain is an error naming both. A user recipe literally named `browser` or a code recipe whose name contains `:` keeps whatever behaviour it has today (check, and record).

- Identity keys: a chain written either way gives the same identity (tested), so no state reset.
- Trust rules unchanged (browser engines are already subject to them; tested for both spellings).
- README, CONTEXT.md, the upgrade table ("Upgrading from serpcast" gains the row), pi-webveil README.
- Delete the observation note.
- Changesets: `webveil` minor and `pi-webveil` minor.

## Acceptance criteria

- [ ] `browser:<recipe>` works; `searchcast:<recipe>` works with one warning; both-at-once is an error (tested).
- [ ] Same identity either way; trust tests for both; docs updated; the gate is green.

## Blocked by

- engine-neutral-no-em-dashes (both edit the README)

## Prompt

Goal: a config reads as what it does. Read `spellings.ts` and the backend's engine-name parsing. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Versions move only through `.changeset/*.md`; never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: SSRF guard on every hop, trust layers, per-identity state, egress on every hop, strict impersonation, no runtime download.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
