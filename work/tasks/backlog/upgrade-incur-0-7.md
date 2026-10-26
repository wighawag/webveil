---
title: Upgrade incur to 0.7.x and drop the MCP SDK pin and the dead pnpm override if no longer needed
slug: upgrade-incur-0-7
blockedBy: [profile-expiry-under-partition-lock]
covers: []
---

## What to build

webveil pins `incur` 0.4.10, and with it a direct `@modelcontextprotocol/server@2.0.0-alpha.2` dependency plus a root `pnpm.overrides` entry, because incur 0.4.10 imported `StdioServerTransport` from the SDK root, which alpha.3 moved to `./stdio`. The `pnpm` field is also ignored by pnpm 11, so that override is dead. incur 0.7.1 is published. Upgrade to the latest 0.7.x, adapting webveil's CLI/MCP frontend to any API change, and then: if 0.7.x resolves the SDK correctly, drop the direct SDK dependency and the override; if not, keep the direct pin and move the override to `pnpm-workspace.yaml` `overrides:` where pnpm 11 reads it. Also check whether 0.7.x still writes an em dash in `--help` titles or makes the separator configurable; if configurable, use a colon.

## Acceptance criteria

- [ ] `incur` is on the latest 0.7.x; every CLI command, `--help`, `--llms`, skills and `webveil --mcp` (a real stdio MCP handshake plus a `web_search` tool call against a fake backend) still work, covered by tests.
- [ ] The SDK pin and the override are either removed (with evidence that the resolved SDK works for a consumer install, for example via the existing pack/install check) or kept with the override moved to `pnpm-workspace.yaml`; no pnpm warning about the `pnpm` field remains.
- [ ] The em-dash question is answered in the done record; the help output uses no em dash if incur allows it.
- [ ] A changeset (minor if any user-visible CLI output or flag changes, otherwise patch).

## Blocked by

- profile-expiry-under-partition-lock (serialized: package.json and lockfile churn last among the code tasks)

## Prompt

Origin: observations `incur-mcp-sdk-version-skew`, `pnpm-overrides-ignored-by-pnpm-11` and `2026-10-01-incur-help-em-dash`. Read incur's changelog between 0.4.10 and 0.7.x before changing code. Delete each observation note that this resolves; append an `## Update` to any that stays open.

FIRST, check this task against current reality (launch snapshot; may have drifted). RECORD non-obvious in-scope decisions.
