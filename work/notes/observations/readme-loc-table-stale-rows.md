---
title: README LOC table has stale rows (trust.ts)
slug: readme-loc-table-stale-rows
---

Observed 2026-09-29 (task `web-fetch-via-serpcast-transport`). The "Size discipline" table in `README.md` lists `src/core/trust.ts` at 166 LOC, but the file is 230 lines at `994f2c1` (it grew with the Windows path tasks), so the subtotal and total are low too. That task only updated the rows of the modules it touched.
