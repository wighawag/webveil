---
title: unix-socket isolation test asserted a real install path is absent — fails once SearXNG is actually installed
slug: unix-socket-isolation-test-asserts-real-path-absent
type: observation
status: spotted
spotted: 2026-06-27
---

The `searxng-unix-socket-baseurl` feature (PR #11) shipped an isolation test that fails on
exactly the machines webveil targets: those with SearXNG installed.

## What was seen

`packages/webveil/test/unix-socket.test.ts` > "leaves NOTHING outside the temp fixture"
ended with:

```ts
expect(existsSync('/usr/local/searxng/run/socket')).toBe(false);
```

The intent (per the task's shared-write-isolation acceptance criterion) was "this test never
touched a real install path." But the assertion actually checks "this real path does not
exist ON THE MACHINE." It passed in CI / on a dev box with no SearXNG, and passed during the
build because nothing was installed yet — then FAILED later the same session once SearXNG was
installed for real (`sudo -H ./utils/searxng.sh install all`), which creates
`/usr/local/searxng/run/socket`. Red gate:

```
expect(existsSync('/usr/local/searxng/run/socket')).toBe(false)
  expected true to be false
```

## Why it is a real bug (not a flake)

`existsSync` of a pre-existing, machine-global path proves nothing about what the TEST
created — and the path it picked is the canonical SearXNG socket, so the test is
GUARANTEED to fail for any user who has SearXNG installed (the whole point of webveil). An
isolation test must assert over its OWN fixture, never the absence of an unrelated global
path. This is the inverse of the shared-write-isolation rule: the rule says "point writes at
a temp dir and assert the real one is untouched," but "untouched" cannot be implemented as
"does not exist."

## Fix applied (this session)

Dropped the brittle line; the meaningful isolation is the temp-dir-only assertions, tightened
to exact contents:

```ts
expect(existsSync(socketPath)).toBe(true);      // our socket is in the temp dir
expect(readdirSync(dir)).toEqual(['iso.sock']); // and the temp dir holds NOTHING else
```

No real machine path is referenced. Gate green again (142/142).

## Generalisable lesson

Two instances of the same shape now (the merged feature + this fix): an "assert the real
location is untouched" criterion must be expressed as "my temp fixture contains exactly what
I created, and nothing leaked," NOT as "a hard-coded global path is absent." Worth watching
for in future shared-write-isolation tests; if it recurs, encode it as a test helper.
