---
title: README section for NixOS (verified live), and require serpcast ^0.1.1 (the exit-deadlock fix)
slug: readme-nixos-and-serpcast-0-1-1
blockedBy: []
covers: []
---

## What to build

Two things found by live testing webveil 0.5.0 on NixOS (2026-09-29, conductor, Node 24.19.0, Tor client on 127.0.0.1:9050):

1. **Dependency.** serpcast 0.1.0's transport deadlocked `process.exit()` while a request was in flight, so every failed or timed-out serpcast search in the webveil CLI hung forever (incur exits on a failed command). serpcast 0.1.1 fixes it (verified: the failing search now exits right after its timeout). Raise `serpcast` in `packages/webveil/package.json` to `^0.1.1`, update the lockfile, add a changeset (patch) saying why.

2. **README, a short "On NixOS" subsection** under the serpcast quick start (keep it compact; single-line paragraphs; no em dashes). Everything below was verified on this date, say so:
   - **libcurl-impersonate.** Either works: `npx serpcast install-libcurl` (the prebuilt linux-x64 library needs only libc, loads into Node on NixOS, and finds the CA bundle NixOS provides at `/etc/ssl/certs/ca-certificates.crt`), or nixpkgs' `curl-impersonate`, which is the same pinned release (2.1.1, identical JA4/HTTP2 fingerprint measured). Do not put a `/nix/store/...` path in `webveil.json`/global config: it breaks after an upgrade or garbage collection. Instead link it where serpcast looks by default, for example with home-manager: `xdg.dataFile."serpcast/libcurl-impersonate.so".source = "${pkgs.curl-impersonate}/lib/libcurl-impersonate.so";` (serpcast's data dir is `$XDG_DATA_HOME/serpcast/`), or set `WEBVEIL_SERPCAST_LIBCURL_PATH` in a dev shell. Check with `npx serpcast doctor`.
   - **npm's allow-scripts warning for `koffi`** (npm 11 blocks its install script): harmless, koffi's prebuilt binary loads without it.
   - **Browser engines (searchcast library mode).** Point `serpcast.searchcast.chrome` at nixpkgs Chromium (`${pkgs.chromium}/bin/chromium`, or `/run/current-system/sw/bin/chromium` when installed system-wide); browsers downloaded by other tools (for example Playwright's) only run with `programs.nix-ld` enabled. Without a display (a server, an SSH session) set `serpcast.searchcast.xvfb` to nixpkgs' Xvfb (`${pkgs.xvfb}/bin/Xvfb`; `pkgs.xorg.xvfb` on older nixpkgs), or pass `"chromeArgs": ["--headless=new"]` (easier for sites to detect). Both verified.
   - **Tor.** `services.tor.client.enable = true;` gives a SOCKS proxy on `127.0.0.1:9050`; use `"egress": {"mode": "socks5", "url": "socks5://127.0.0.1:9050"}` (webveil hands serpcast `socks5h`, so DNS stays at Tor). Verified: search and `web_fetch` (both transports) exit through Tor (`check.torproject.org/api/ip` reports `IsTor: true`) with the same fingerprint as direct.

Also add one sentence to the serpcast quick start, wherever the Marginalia example is mentioned or the recipe step is (if the example is not mentioned yet, mention it: serpcast's `examples/recipes/marginalia.mjs`, a code recipe, so it goes under `serpcast.codeRecipes` in the global config): the shared `public` key is often rate limited or unresponsive (it timed out for most test queries on 2026-09-29, direct and through Tor), so ask Marginalia for a free personal key and set `MARGINALIA_API_KEY`.

## Acceptance criteria

- [ ] `serpcast` dependency is `^0.1.1` with an updated lockfile; changeset (patch) added; verify gate green.
- [ ] README has the NixOS subsection with the points above, and the Marginalia key note; no em dashes; single-line paragraphs.

## Blocked by

- None, can start immediately.

## Prompt

FIRST, check this task against current reality (README structure may have moved). Keep the README additions short.
