---
title: install-recipes errors have real codes, and the not-a-set suggestions are incur call-to-actions, readable in a terminal and to agents
slug: install-errors-readable
blockedBy: []
covers: []
---

## What to build

Since webveil 0.14.1, `webveil install-recipes ipfs://<cid>` on a folder that is not a recipe set (for example a release folder's root) fails with a message that embeds the suggested `webveil install-recipes ...` commands, one per line (`notASetMessage` in `packages/webveil/src/setup.ts`). Run with output not on a terminal (an agent, a pipe, a redirect), incur prints the error as TOON, and the result was observed live on 2026-10-01:

```
code: UNKNOWN
message: "webveil install-recipes: the directory entry \"README.txt\" ... Nothing was installed. Try one of:\n  webveil install-recipes ipfs://.../x.tar.gz --sha256 ... --direct --force   # a release archive\n  webveil install-recipes ipfs://.../x --direct --force   # may be a set directory"
```

Two problems: the code is `UNKNOWN` (incur's code for a thrown non-incur error), and the commands are buried in an escaped string, with literal `\n`, so they cannot be copied. In a terminal incur prints `Error (CODE): message`, so the code is wrong there too.

Use incur as designed (its README: "Call-to-actions", "Middleware" errors, `c.error({code, message, exitCode, cta})`):

1. **Codes.** In `cli.ts`'s install wrapper (`runInstall`, which already turns `UsageError` into `c.error` with exit 2), turn searchcast's `InstallError` into `c.error` with exit 1 and a real code: `NOT_A_RECIPE_SET` for the refusal that carries `suggestions`, `INSTALL_FAILED` for any other `InstallError`. The same for `install-libcurl` (its errors are `InstallError` too). Anything else still throws as today.
2. **Suggestions as call-to-actions.** For `NOT_A_RECIPE_SET`, the message becomes one line: the listing (as today, up to searchcast's ". Try: ") and "Nothing was installed." The suggested commands go in `cta.commands`, one per suggestion, with its kind as the description ("a release archive" / "may be a set directory"), built exactly as `notASetMessage` builds them today (route flag as typed, `--proxy <url>` as a placeholder and NEVER the typed proxy URL or its credentials, typed `--ipfs-gateway`, `--name`, `--force`, `--sha256` on the archive suggestion only, shell quoting). Check how incur renders a CTA command (it may prefix the CLI name itself; no `webveil webveil`) and how it renders in TOON, JSON and MCP: an agent must receive the commands as data in each, and a human in a terminal must see a `Next:` list, one command per line. If incur cannot attach a CTA to an error in one of these modes, keep the commands in the message for that mode only and record why.
3. **The library API** (`installRecipes` in setup.ts, used by pi-webveil and MCP) still throws an `InstallError` with `suggestions`, so programmatic callers are unchanged; move only the formatting to the CLI layer. The message no longer embeds the commands; say so in the changeset.
4. **Tests (offline):** run the CLI (as the existing CLI tests do) on the release-folder fake gateway: the TOON/JSON output has code `NOT_A_RECIPE_SET`, exit 1, a one-line message, and the commands as call-to-actions with the right flags; the `--proxy` case still never shows the URL or its credentials; another install error has `INSTALL_FAILED`; usage errors keep their codes and exit 2. A human-mode (TTY) rendering test if the existing tests have a way to force it; otherwise record how you checked it.
5. Changesets: `webveil` patch and `pi-webveil` patch.

## Acceptance criteria

- [ ] The not-a-set refusal exits 1 with code `NOT_A_RECIPE_SET`, a one-line message, and its commands as incur call-to-actions in TOON and JSON (and MCP, or a recorded reason); no literal `\n` inside the message (tested offline).
- [ ] Other `InstallError`s have code `INSTALL_FAILED` (exit 1); usage errors unchanged (exit 2); no proxy URL or credential in any output (tested); the gate is green.

## Blocked by

- None, can start immediately.

## Prompt

Goal: a refusal reads cleanly in a terminal and parses cleanly for an agent. Read `packages/webveil/src/cli.ts` (`runInstall`), `packages/webveil/src/setup.ts` (`notASetMessage` and the credential rule in its header), the CLI tests, and incur's README (`npm view incur@0.4.10 readme`; do NOT grep `node_modules`). FIRST, check this task against current reality. RECORD non-obvious in-scope decisions.

## Rules for this build

- Versions move only through `.changeset/*.md`; never edit a `version` field, never 1.0.0. Nothing is published by this task.
- Security properties stay tested and unchanged: SSRF guard on every hop, trust layers, per-identity state, egress on every hop, strict impersonation, no runtime download. No secret (a proxy URL's credentials included) in any output.
- Make NO live network request.
- No em dashes anywhere; do not hard-wrap Markdown paragraphs. Public repo: no real search engine named except Mwmbl and Marginalia.
- Bound shell commands (`timeout`), cap output, never grep `node_modules`, `dist` or `.git`. No network in tests.
