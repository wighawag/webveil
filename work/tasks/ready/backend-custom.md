---
title: Custom local-command backend (JSON stdin/stdout contract)
slug: backend-custom
prd: webveil-tool-and-pi-extension
blockedBy: [core-foundation-config-egress-http, backend-searxng, backend-tavily-compat]
covers: [8]
---

## What to build

A `custom` backend that shells out to a local command, passing the query as JSON on stdin
and reading normalized results as JSON on stdout (contract lifted from pi-web-providers'
custom-wrapper). End-to-end: the registry resolves `backend: 'custom'` to this backend,
which round-trips the JSON stdin/stdout contract with a configured command and returns
`SearchResult[]`. This is the escape hatch for any local script.

## Acceptance criteria

- [ ] The registry resolves `'custom'` to this backend (registration appended to the
      shared `registry`, AFTER the tavily-compat one to avoid a same-file conflict).
- [ ] The backend spawns the configured command, writes the request JSON to stdin, and
      parses the response JSON from stdout into `SearchResult[]`.
- [ ] Malformed command output fails clearly (does not silently return empty).
- [ ] Tests round-trip the JSON contract against a small fake/echo command (no network),
      using a temp script fixture; assert no shared/global location is written.

## Blocked by

- `core-foundation-config-egress-http` — needs the `Backend` interface.
- `backend-searxng` — serialized because both edit the shared `registry`.
- `backend-tavily-compat` — also edits the shared `registry`; serialized after it so the
  two registrations cannot collide on the same file.

## Prompt

> Build webveil's `custom` backend: a local-command escape hatch using a JSON stdin/stdout
> contract (lifted from pi-web-providers' custom-wrapper). Read `CONTEXT.md` (backend seam)
> and the PRD. The `Backend` interface comes from `core-foundation-config-egress-http`; the
> registry exists from `backend-searxng` (add your registration).
>
> The backend spawns the configured command, writes the request as JSON to stdin, and
> parses `SearchResult[]` from stdout. Malformed output must fail clearly, not silently
> return empty. (Network egress does not apply here — the command owns its own I/O — but it
> still returns the normalized shape.)
>
> Test the contract round-trip against a small temp echo-script fixture; no network, and
> assert nothing outside the test's own temp fixtures is written. Done = backend +
> registration land with passing tests and a green verify gate. FIRST check against current
> reality; RECORD non-obvious in-scope decisions.
