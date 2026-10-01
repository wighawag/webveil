---
title: Name no real search engine (except Mwmbl and Marginalia) and write no em dash, in code, tests, docs and user-facing text
slug: engine-neutral-no-em-dashes
blockedBy: []
covers: []
---

## What to build

Two owner rules the repo still breaks (observation `work/notes/observations/2026-09-30-readme-and-context-name-bing.md`, and Gate-3 notes of the searchcast move):

1. **Engine neutrality.** No real search engine is named in code, comments, tests, examples or docs, except Mwmbl and Marginalia (the bundled default engines, owner-approved). Today the READMEs (root and the package copies), `CONTEXT.md`, `docs/searxng-setup.md`, source comments (`config.ts`) and tests (`searxng.test.ts`, `tunables.test.ts`, `searchcast.test.ts`) name engines in decoy-guard examples, SearXNG engine lists and "(-> Google/Bing/...)" asides. Replace them with placeholders (`engine-a`, "the search engines", "an engine that serves decoys") so every statement stays true. SearXNG (the metasearch software), Tor, Mullvad, Proton and similar non-engine names stay. Test data keeps its meaning (an engine list stays a list of distinct names). Notes under `work/` and CHANGELOG history entries are history and stay.
2. **No em dashes.** About 100 remain outside `work/` and the changelogs: in `webveil --help` (its first line), pi-webveil's model-facing tool text (the `[warning] search degraded ... unresponsive engines` line), source comments, tests, the READMEs, `CONTEXT.md`, `docs/` and `media/README.md`. Rewrite each sentence without one (a colon, a comma, parentheses or two sentences, whichever reads naturally; never a spaced hyphen). Update tests that assert those strings. CHANGELOG history stays.

Add a guard so neither comes back: a test (or a script in the gate) that fails on an em dash in any tracked file outside `work/` and `*/CHANGELOG.md`, and on a denylist of mainstream engine names (word-boundary, case-insensitive) in the same files, with the two approved names allowed. Keep the denylist in one place.

Changesets: `webveil` patch and `pi-webveil` patch (help text and tool text change).

## Acceptance criteria

- [ ] No em dash and no non-approved engine name in tracked files outside `work/` and changelogs (the new guard proves it and fails on a fixture).
- [ ] Every statement keeps its meaning; tests updated, none weakened; the gate is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: the public repo follows the owner's two rules, and a guard keeps it that way. Mechanical, but read each sentence you rewrite. FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Versions move only through `.changeset/*.md`; never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: SSRF guard on every hop, trust layers, per-identity state, egress on every hop, strict impersonation, no runtime download.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
