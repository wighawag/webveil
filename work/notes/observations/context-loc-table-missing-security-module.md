2026-06-26: CONTEXT.md's per-module LOC target table (and the README it says
should track LOC) has no row for `core/security.ts`, even though the SSRF guard
is an explicit module (adapted from leing2021/pi-search's `security.ts`). Added
`core/security.ts` (~141 LOC, mostly doc-comments + IPv4/IPv6 range
classification) during the core-fetch-ssrf task. Also `core/fetch.ts` came out
~132 LOC vs the ~90 target (largely comments). No README exists yet to record
LOC in. Flagging for whoever owns the README/LOC-tracking task.
