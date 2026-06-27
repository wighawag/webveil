---
'webveil': patch
---

Fix the `webveil` CLI silently producing no output when run via its
npm-installed bin (`npx webveil ...` or a `node_modules/.bin/webveil` entry).
The `isMain()` entry-point guard compared `argv[1]` (the `.bin/webveil` symlink
npm creates) against `import.meta.url` (the real `dist/cli.js`) without
resolving symlinks, so the comparison was always false for an installed bin and
the CLI never served (exit 0, empty output). Both sides are now resolved with
`realpathSync` before comparing. Added a regression test that launches the built
bin through a symlink and asserts it serves.
