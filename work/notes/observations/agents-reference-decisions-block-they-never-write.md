---
title: Build agents reference a "Decisions block" in code comments but never add it to the done record
slug: agents-reference-decisions-block-they-never-write
---

## The pattern (generalised — 3 instances, a SIGNAL not noise)

Across the webveil build drive, multiple `do` build agents made a sound, non-obvious
in-scope decision, wrote an in-CODE comment saying "(Recorded decision; see the task's
Decisions block.)", but then did NOT add any `## Decisions` block to the done record
`work/tasks/done/<slug>.md`. The code comment references a record that does not exist.

Instances seen:
1. **PR #1 core-foundation** — substituted `fetch-socks` for the spec-pinned
   `socks-proxy-agent` (separate note: socks-dep-is-fetch-socks-...). No decision recorded.
2. **PR #4 core-search** — invented `DEFAULT_MAX_RESULTS = 10`; comment cites a Decisions
   block that is absent (separate note: core-search-default-max-results-...).
3. **PR #7 backend-custom** — parses `config.baseUrl` as a whitespace-split argv for the
   command line; comment cites "the task's Decisions block" — absent.

## Why it matters

Each individual decision is FINE and well-commented in the code (so this is not a bug, and
each PR was approved on behaviour). The defect is the BROKEN PROMISE: the code points a
future reader at a "Decisions block" for the rationale, and there is nothing there. Either
the comment should not claim a record exists, OR the record should be written. The task
template's "RECORD non-obvious in-scope decisions" rung is being half-satisfied: the agent
KNOWS it made a decision (it says so in the comment) but writes the record in the wrong
place (a code comment) instead of the done record / an ADR.

## Suggested fix (generalised, not per-instance)

This is a harness/prompt-level issue, not a webveil code issue. Options:
- The done-record template (or the runner's done-move) should carry an explicit
  `## Decisions` section the agent fills, so "see the Decisions block" resolves.
- OR the agents' prompt should say: record the decision IN the done record / an ADR, and
  only reference it from code if it actually exists.

For webveil specifically: the in-code comments ARE currently the de-facto record and are
adequate; no code change is needed. This note is the record that the pattern was observed,
so a human can decide whether to tighten the harness. Lower priority than shipping features.
