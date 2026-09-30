---
title: webveil installs libcurl-impersonate and recipes itself, and exposes every tuning value as config
slug: webveil-installs-and-tunables
spec: serpcast-backend
blockedBy: []
covers: []
---

## What to build

Owner decisions (2026-09-30): webveil should be the only thing a user installs, and no magic numbers or unswitchable behaviours a user might need to change. serpcast 0.6.0 (released 2026-09-30) provides what this needs: the `serpcast/install` subpath (`installLibcurl`, `installRecipes`, recipe-set listing, doctor report; the main `serpcast` entry has no download code), and options `reuseConnections`, `keepSessions`, `idlePollMs`, `maxRequestBodyBytes`, `preflightCache`, `maxPreflightAgeS`, `maxRedirects`, `decoyRule`, `decoyGuard: {include, exclude}`, per-endpoint `maxBodyBytes` (read its README options tables).

**1. Commands** (CLI; also MCP tools? decide and record: installing downloads code, so an agent-callable install tool is a real question; recommended: CLI only, not exposed over MCP or pi, because the pin is the human's trust decision):
- `webveil install-libcurl [--proxy <url>] [--force]`: wraps `installLibcurl`. `--proxy` defaults to NOTHING (never silently the configured egress; say in the help that `--proxy socks5h://...` routes the download, and record why it is not implied: the user decides where a download goes). Prints what and where.
- `webveil install-recipes <url|path> --sha256 <hex> [--name <set>] [--proxy <url>] [--force]`: wraps `installRecipes`; the pin is required.
- `webveil recipes` (list installed sets), and `webveil doctor`: the serpcast doctor report plus webveil's view: resolved backend, egress (credentials redacted), fetch transport, which engines resolve to which recipe files, and whether each configured `set:` exists. No network unless `--remote`.
These lazily import `serpcast/install` so ordinary `search`/`fetch` never load download code. Keep the "only download path" guarantee in webveil too (a test that the search/fetch modules do not reach it).

**2. Config keys** (global, project and env like the others; data, not executable; validated, fail loud; defaults unchanged). Names are yours to choose consistently and record; cover at least:
- `web_fetch` pool: max idle sessions (4), idle close time (10 min), connection reuse on/off (on), per-request timeout and body cap (15 s, 16 MiB), max redirects (20, shared with the plain path's guard).
- The plain HTTP helper timeout (30 s) and the default search `maxResults` (10).
- serpcast pass-throughs under `serpcast.*`: `reuseConnections`, `keepSessions`, `idlePollMs`, `maxRequestBodyBytes`, `preflightCache`, `maxPreflightAgeS`, `maxRedirects`, `decoyRule`, `decoyGuard` object form (array form still accepted), `timeoutMs`, `maxBodyBytes`, and the endpoint's `maxBodyBytes`.
- State store: persistence on/off (`off` = serpcast's in-memory store, nothing written to `$XDG_STATE_HOME`), and the lock stale and wait times (10 s, 30 s).
Anything that changes what an instance does joins the identity key automatically (it is part of the resolved section); record which keys you deliberately keep OUT of the key (for example pure timeouts), if any, and why.

**Not configurable, on purpose** (say so in the README): strict impersonation, the SSRF guard, the trust rules for executable settings, checksum pins.

**3. README:** a short "Install" rewrite (webveil alone: `npm i -g webveil`, `webveil install-libcurl`, `webveil install-recipes ...`, `webveil doctor`), NixOS section updated to use the webveil commands, and one reference table of every config key with default, env name and meaning.

## Acceptance criteria

- [ ] The four commands work (tests with a local release server and temp `XDG_DATA_HOME`, as serpcast's installer tests do; real data dir untouched); install commands are not exposed over MCP/pi (or the recorded decision says otherwise, with its safeguard); search/fetch do not load the install code (tested).
- [ ] Every key listed above is read from global, project and env, validated, passed where it belongs, tested with its default unchanged and a set value taking effect.
- [ ] README install section, NixOS section and the config reference table; changeset (minor).

## Blocked by

- None, can start immediately.

## Prompt

Read serpcast 0.6's README and `serpcast/install` types first. FIRST, check this task against current reality. RECORD non-obvious decisions.

## Decisions

Each is written up in a comment where the choice is made, and all are indexed in `work/notes/observations/2026-09-30-webveil-installs-and-tunables-decisions.md`.
1. **All four setup commands are CLI only**, including the read-only `recipes` and `doctor`. `--proxy` defaults to a direct download, never the configured egress. There is no `--dir` option, because webveil only looks for `set:` entries in the default recipes directory. (`setup.ts`, `cli.ts`)
2. **`doctor`'s rules:**
   - The library only counts toward "healthy" when the serpcast backend or serpcast fetch transport uses it.
   - `--remote` goes through the backend egress when the backend is serpcast, otherwise through the fetch egress.
   - Listing a code recipe's engine name means importing (running) that module, after the same trust check a search does.

   (`setup.ts`, and `describeSerpcastEngines` in `serpcast.ts`)
3. **Key names and placement:** the fetch transport's keys went into a new `fetchSerpcast` section rather than under `serpcast`. The whole `serpcast` section feeds the search identity key, so a fetch setting there would move the search state. (`tunables.ts`, `config.ts`)
4. **No key is kept out of the identity key.** That key names both the cached instance and the on-disk state, and every new key is an instance option. As a result, changing any `serpcast` key, even a timeout, starts fresh engine sessions. Unset keys don't change it, so existing state stays where it is. (`serpcast.ts`)
5. **`serpcast.decoyGuard` is replaced whole across config layers**, so a list in one layer and an object in another don't mix. (`layers.ts`)
6. **`fetchMaxRedirects` behind a proxy:** when set, the plain fetch guard follows redirects itself there too. When unset, the proxied path is unchanged. This partly reverses an earlier recorded decision. (`security.ts`)
7. **Two combinations and a fallback:**
   - `state.persist: false` together with `persistProfile: true` is an error.
   - `webveil state clear --all` uses the default lock times.
   - `serpcast.sessionIdleMs` must now be positive; serpcast 0.6 rejects 0 anyway.

   (`serpcast.ts`, `state.ts`, `tunables.ts`)

Two things I noticed but left alone, both logged in the same note: webveil still doesn't expose serpcast's `caPath` or the browser's `headless` and `concurrency` options as keys. And serpcast's own doctor message says `serpcast install-libcurl`, so webveil's doctor appends the webveil command.
