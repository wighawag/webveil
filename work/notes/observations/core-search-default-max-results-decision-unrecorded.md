---
title: core-search invented DEFAULT_MAX_RESULTS=10 but the referenced Decisions block is missing
slug: core-search-default-max-results-decision-unrecorded
---

## What was observed

`core-search` (PR #4) sets a default result cap `DEFAULT_MAX_RESULTS = 10` when the caller
omits `maxResults`. The PRD/spec never pinned a default cap, so this is a non-obvious
in-scope decision. The code comment says "(Recorded decision: ... see the task's Decisions
block.)", but the done record `work/tasks/done/core-search.md` has NO `## Decisions`
block. So the code references a decision record that does not exist.

Per the task template ("RECORD non-obvious in-scope decisions; an un-recorded in-scope
decision is a review FINDING"), this is a finding, the same class as the fetch-socks
substitution on PR #1.

## Assessment

The decision itself is fine and well-commented in-code: default cap 10 keeps an agent's
context small, a caller can override per call, and dedup runs BEFORE the clamp (tested) so
the caller gets up to N UNIQUE hits. Approved on that basis, the behaviour is correct and
green; only the RECORD is missing.

## Follow-up

Cheap doc reconciliation (no code change):
- Either add a one-line `## Decisions` note to the done record / or accept this observation
  AS the record of the decision (it now states the what + why + that it is overridable).
- Lower-priority than the fetch-socks doc drift; both are doc-vs-code bookkeeping, not bugs.

No re-decision needed; the cap value and the dedup-before-clamp order are sound.
