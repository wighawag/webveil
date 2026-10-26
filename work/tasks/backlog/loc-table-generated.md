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
