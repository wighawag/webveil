---
title: incur CLI/MCP frontend — search + fetch commands
slug: cli-incur-frontend
prd: webveil-tool-and-pi-extension
blockedBy: [core-search, core-fetch-ssrf]
covers: [5]
---

## What to build

The `webveil` frontend: an incur `Cli.create()` with `search` and `fetch` commands that
call the core. Because it is built on incur, this single definition yields the CLI + an
MCP server (`--mcp`) + skills + `--llms` + TOON output + token pagination for free.
Pi-agnostic — any agent (pi via pi-mcp-adapter, Claude Code, Cursor, Codex, bash) can
consume it. The `webveil` bin points at the built `cli.js`.

- Pin the incur version.
- `search <query>` → `core.search()`; `fetch <url>` (with a size flag `s`/`m`/`l`/`f`) →
  `core.fetch()`.

## Acceptance criteria

- [ ] `webveil search <query>` and `webveil fetch <url>` run and call the core.
- [ ] The same definition exposes an MCP server via `--mcp`.
- [ ] The `webveil` bin resolves to the built CLI entry.
- [ ] incur version is pinned.
- [ ] Tests cover that the commands wire to the core (against a fake/mocked core or fake
      `http`), not a live network.

## Blocked by

- `core-search` and `core-fetch-ssrf` — the commands call both core functions.

## Prompt

> Build webveil's incur-based CLI + MCP frontend. Read `CONTEXT.md` (the `webveil`
> frontend, core) and the PRD. `core.search()` and `core.fetch()` already exist.
>
> Use incur's `Cli.create()` to define `search` and `fetch` commands that call the core;
> this yields CLI + MCP (`--mcp`) + skills + `--llms` + TOON + pagination for free. Pin the
> incur version. The `webveil` bin points at the built CLI entry. Keep it pi-agnostic.
>
> Test that the commands wire to the core (mock the core or use a fake `http`); no live
> network. Done = the CLI runs, `--mcp` exposes the MCP server, and the verify gate is
> green. FIRST check against current reality; RECORD non-obvious in-scope decisions.
