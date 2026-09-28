# copy-publish-assets test fails when /tmp/README.md exists

2026-09-28. `packages/webveil/test/copy-publish-assets.test.ts` ("only writes inside the repo root") asserts `existsSync(join(dirname(fakeRepo), 'README.md'))` is false, but `fakeRepo` lives directly in `os.tmpdir()`, so any unrelated `/tmp/README.md` on the machine (one from 2026-09-24 exists on this host) makes it fail regardless of the code. The fake repo should sit in its own temp parent dir.
