---
title: Generate the README LOC column with a script and check it in verify
slug: loc-table-generated
blockedBy: [upgrade-incur-0-7]
covers: []
---

## What to build

The README "Size discipline" table drifts because each task only updates the rows it touches (current misses include `src/cli.ts`, `src/core/config.ts`, `src/core/spellings.ts`, `src/core/backends/searchcast.ts`). Add a dependency-free Node script that rewrites the LOC column from the actual line counts of the listed files (keeping targets, row labels and order as authored, adding rows for source files without one, failing on rows whose file no longer exists), recomputes subtotals and the total, and has a `--check` mode wired into the verify gate; add `pnpm loc` to fix it. Run it once so the table is correct. Keep CONTEXT.md's ceiling table as is (targets are authored).

## Acceptance criteria

- [ ] `pnpm loc` rewrites the column and totals; `--check` fails on a stale table and passes after `pnpm loc`.
- [ ] The verify gate fails when the table is stale.
- [ ] Every source file under `packages/*/src` has a row; every row's file exists.
- [ ] The table is correct at the end of the task.
- [ ] Tests cover the script (stale, fresh, missing file, new file).

## Blocked by

- upgrade-incur-0-7 (serialized: last code-changing task, so the table is generated after them)

## Prompt

Origin: observation `readme-loc-table-stale-rows` (delete it once resolved). The README's LOC definition must stay what its header says; if rows currently mix metrics (lines vs non-blank lines), pick the header's definition and record it. The searchcast repo gets the same kind of script in its own task; you may reuse the idea but not a shared dependency.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.

## Decisions

These are recorded in the comment at the top of `scripts/loc-table.mjs`:
1. **LOC means the plain line count**, like `wc -l`, with blank and comment lines included. That's what the README header says. I rejected counting only non-blank lines because it would quietly change what the header means.
2. **The gate runs through the test suite**, the same way `scripts/text-rules.mjs` does, so `dorfl.json` and the CI workflow are untouched. The alternative was adding `pnpm loc:check` to the verify command, but that would be a second definition of the gate to keep in sync.
3. **A "source file" is any file under `packages/*/src`**, whatever its extension. A package with source files but no README table is an error, because the heading and table are written by hand.
4. **A row whose file is gone fails in both modes** rather than being removed automatically, since its label and target may belong to a file that was renamed.
5. **Tables are re-aligned the way prettier aligns them.** This is only cosmetic: `*.md` is excluded from prettier in this repo.
