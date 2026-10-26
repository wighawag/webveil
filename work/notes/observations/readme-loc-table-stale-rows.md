---
title: README LOC table has stale rows (trust.ts)
slug: readme-loc-table-stale-rows
---

Observed 2026-09-29 (task `web-fetch-via-serpcast-transport`). The "Size discipline" table in `README.md` lists `src/core/trust.ts` at 166 LOC, but the file is 230 lines at `994f2c1` (it grew with the Windows path tasks), so the subtotal and total are low too. That task only updated the rows of the modules it touched.

## Update (2026-10-24)

The `trust.ts` row is now right (230), but other rows have drifted: `src/cli.ts` 326 listed vs 463 actual, `src/core/config.ts` 505 vs 564, `src/core/spellings.ts` 329 vs 449, `src/core/backends/searchcast.ts` 818 vs 1012, `src/core/search.ts` 150 vs 165, `src/setup.ts` 787 vs 764, `src/index.ts` 246 vs 141. Tasks still update only the rows they touch, so a whole-table pass (or a script that regenerates it) is the real fix.
