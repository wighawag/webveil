---
title: Give the copy-publish-assets test its own temp parent so a stray file in the system temp dir cannot fail it
slug: copy-publish-test-own-temp-parent
blockedBy: []
covers: []
---

## What to build

`packages/webveil/test/copy-publish-assets.test.ts` ("only writes inside the repo root, never to a shared/global location") asserts `existsSync(join(dirname(fakeRepo), 'README.md'))` is false, but `fakeRepo` is created directly in `os.tmpdir()`, so any unrelated `README.md` in the system temp directory fails the test regardless of the code. It did, on a build host with a stray `/tmp/README.md` (observation `work/notes/observations/copy-publish-test-fails-on-stray-tmp-readme.md`, which this task resolves and deletes). Create the fake repo one level down inside its own `mkdtemp` parent, so the "nothing written outside the repo root" check looks at a directory the test owns, and clean the parent up afterwards. Test-only change; `scripts/copy-publish-assets` itself is not modified.

## Acceptance criteria

- [ ] The test passes with a `README.md` present directly in `os.tmpdir()` (demonstrate by running it with `TMPDIR` pointed at a temp dir that contains one) and still fails if the code writes a `README.md` next to the fake repo.
- [ ] Temp directories are removed after the tests.
- [ ] The observation note is deleted; no production code changes.

## Blocked by

- None, can start immediately.

## Prompt

Goal: make the verify gate independent of whatever is in the host's temp directory. FIRST, check this task against current reality (launch snapshot; may have drifted).
