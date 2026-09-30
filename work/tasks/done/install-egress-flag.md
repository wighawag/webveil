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

## Decisions

All four are recorded in the comment block at the top of `packages/webveil/src/setup.ts`, under "Recorded decisions (task install-egress-flag)":

1. **Which hop:** `egress` when it is a proxy, otherwise `fetchEgress`. When both are proxies and differ, `egress` wins and the progress line names the unused `fetchEgress`. I chose this because `egress` is the config's main egress and `fetchEgress` is its per-hop override (ADR 0003). The alternatives were taking the fetch hop first or refusing the ambiguous case. This deliberately differs from `doctor --remote`, which picks its hop by backend.
2. **Every hop direct:** `--egress` does a plain direct download and says so on the progress output. It is not an error.
3. **Unusable egress:** exits 1 (the same code as other failures, not the exit-2 usage errors) and nothing is requested. It never falls back to direct.
4. **Local file:** `--egress` is ignored and the config is not resolved, the same as `--direct`. The conflict checks still apply.

Nothing outside the task's scope needed an observation note. The working tree holds only the intended changes (`dist` is gitignored).
