---
title: Install commands refuse to guess the download route when egress is not direct
slug: install-route-explicit-under-proxy-egress
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

Owner decision (2026-09-30). `webveil install-libcurl` and `webveil install-recipes` download directly unless `--proxy` is given (task `webveil-installs-and-tunables`, decision 1). With a proxy egress configured (Tor, a VPN SOCKS proxy), that silently sends the download from the real IP: integrity is fine (checksum-pinned), but it tells the host (GitHub) that this IP installed libcurl-impersonate or a recipe set, possibly just before the same machine searches over the proxy.

New rule, for both commands (and any future webveil command that downloads):
- Resolve the config as `search` would (cwd, project, global, env). If the relevant egress is `direct`, behave as today (direct unless `--proxy`).
- If it is NOT `direct` (`http` or `socks5`), require an explicit choice: `--proxy <url>` or a new `--direct` flag. Without either, refuse before any network request, exit 2 (usage error), with a message that names the configured egress (credentials redacted), says why (the download would otherwise leave from this machine's own IP), and shows both options, including a ready-to-paste `--proxy` value derived from the configured egress (SOCKS as `socks5h://`, as webveil maps it elsewhere). `--proxy` and `--direct` together is a usage error.
- Which egress counts: decide and record (recommended: the backend-hop `egress`, and also refuse when `fetchEgress` is set and not direct, since either being proxied signals the user wants that traffic off their IP).
- A local file path for `install-recipes` makes no network request, so the rule does not apply there (no flag needed); say so in the help.
- `doctor --remote` already goes through the egress; leave it.

README: in the Install and NixOS sections, one sentence on the rule, and note that `gh release download` (used to fetch a private release asset before `install-recipes <file>`) is not routed by webveil, so run it through the proxy yourself if that matters (for example `torsocks gh release download ...` or `ALL_PROXY`/`HTTPS_PROXY` for gh), and that under anonctl the kernel forces everything anyway.

## Acceptance criteria

- [ ] Direct egress: unchanged behaviour (existing tests pass).
- [ ] Proxy egress (http and socks5, from global, project and env; and via `fetchEgress` per the recorded decision): no flag refuses with exit 2 and no request made (local release server records nothing); `--direct` downloads directly; `--proxy` goes through the given proxy; both flags is a usage error; the message redacts credentials and suggests the `socks5h://` form.
- [ ] `install-recipes <local file>` needs no flag under a proxy egress.
- [ ] README updated; changeset (minor: new flag, new refusal).

## Blocked by

- None, can start immediately.

## Prompt

Read `packages/webveil/src/setup.ts` and `cli.ts`. FIRST, check this task against current reality. RECORD non-obvious decisions.
