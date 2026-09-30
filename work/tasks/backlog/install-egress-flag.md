---
title: `--egress` on the install commands: download through the configured egress
slug: install-egress-flag
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

Owner request (2026-09-30). The install commands (`install-libcurl`, `install-recipes <url>`) now refuse to guess the route under a non-direct egress and require `--proxy <url>` or `--direct` (task `install-route-explicit-under-proxy-egress`). Add a third explicit choice, `--egress`: download through the egress webveil already has configured, resolved exactly as `search` resolves it (cwd, project, global, env), mapped as webveil maps it for serpcast (`serpcastProxy`: SOCKS as `socks5h://` so DNS stays at the proxy, `http` as is). Its credentials are used but never printed (only the redacted form appears in output). This is better than the pasted `--proxy` suggestion, which is redacted and so unusable for an authenticated proxy.

- Which hop: the backend-hop `egress` by default; when that is `direct` but `fetchEgress` is not, use `fetchEgress` (the only proxied hop). When both are proxied and differ, use `egress` and say which one in the progress output. Record the rule.
- `--egress` when every hop is `direct`: a download that is simply direct (say so in the output), not an error.
- Mutually exclusive with `--proxy` and `--direct` (usage error, exit 2).
- The refusal message now offers `--egress` FIRST (it is the likely intent), then `--proxy <url>` and `--direct`.
- The egress must be buildable (a `socks5`/`http` URL the downloader supports); an unsupported or malformed one fails loud before any request, like `search` would.
- Local file for `install-recipes`: accepted and ignored, like `--direct`.
- README Install and NixOS sections: lead with `--egress` for proxied setups.

## Acceptance criteria

- [ ] `--egress` downloads through the configured egress (local SOCKS/HTTP test proxy records the request, with credentials passed through when the egress has them, and the output never contains them), from global, project and env configs; the `fetchEgress` rule as recorded; all-direct is a plain direct download.
- [ ] Conflicts with `--proxy`/`--direct` are usage errors; the refusal message lists `--egress` first; existing route tests pass.
- [ ] README; changeset (minor).

## Blocked by

- None, can start immediately.

## Prompt

Read `packages/webveil/src/setup.ts` (`downloadRoute`). FIRST, check this task against current reality. RECORD non-obvious decisions.
