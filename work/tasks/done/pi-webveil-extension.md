---
title: pi-webveil extension — web_search + web_fetch (Ollama drop-in) over the core
slug: pi-webveil-extension
prd: webveil-tool-and-pi-extension
blockedBy: [core-search, core-fetch-ssrf]
covers: [6, 7]
---

## What to build

The `pi-webveil` package: a pi extension registering exactly `web_search` and `web_fetch`
(same names as Ollama) that call webveil's core IN-PROCESS (no shelling), as a literal
drop-in replacement for `@ollama/pi-web-search`. End-to-end: load the extension in pi, call
`web_search`/`web_fetch`, and they route to `core.search()`/`core.fetch()` with per-folder
config resolved from `ctx.cwd`. Replace the placeholder in `packages/pi-webveil/src/index.ts`.

- Tool names MUST be exactly `web_search` / `web_fetch` for the Ollama drop-in.
- Depends on `webveil` via `workspace:*`; calls the exported core functions directly.
- Resolve per-folder config from `ctx.cwd` (each folder = its own account/egress).
- Optional compact `renderResult` is the most TUI we add (no commands/widgets/statusline).

## Acceptance criteria

- [ ] The extension registers EXACTLY two tools named `web_search` and `web_fetch`.
- [ ] Each tool calls the corresponding webveil core function in-process (no shelling).
- [ ] Per-folder config is resolved from `ctx.cwd`.
- [ ] Tests assert the two tool names + that they route to the core (mock the core / fake
      `http`); no live network, and isolate any config path read in tests.

## Blocked by

- `core-search` and `core-fetch-ssrf` — the tools call both core functions.

## Prompt

> Build the `pi-webveil` pi extension: a drop-in replacement for Ollama's web tools. Read
> `CONTEXT.md` (the `pi-webveil` frontend, drop-in note) and the PRD (stories 6/7).
> `core.search()`/`core.fetch()` exist in the `webveil` package (depend on it via
> `workspace:*`).
>
> Register EXACTLY two tools named `web_search` and `web_fetch` (the exact names are what
> make it an Ollama drop-in — do not rename). Each calls the webveil core IN-PROCESS (no
> shelling). Resolve per-folder config from `ctx.cwd` (each folder = its own
> account/egress). An optional compact `renderResult` is the most TUI to add. Replace the
> placeholder in `packages/pi-webveil/src/index.ts`.
>
> Test: assert the two registered tool names and that they route to the core (mock the core
> or use a fake `http`); no live network; isolate any config path the test reads. Done =
> the extension registers the two tools and routes to the core, with a green verify gate.
> FIRST check against current reality; RECORD non-obvious in-scope decisions.
