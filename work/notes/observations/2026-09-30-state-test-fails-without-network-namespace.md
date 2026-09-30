---
title: state.test.ts concurrent-process test fails inside a network namespace
date: 2026-09-30
---

Running the webveil suite offline as `unshare -rn sh -c 'ip link set lo up && npx vitest run'` (a handy way to prove no test reaches the network) fails only `test/state.test.ts > createStateStore: concurrent processes` (the four `tsx` writer children exit 1); everything else passes, and the test passes normally. Probably tsx's IPC socket under the user+net namespace, not a webveil bug; noticed during task default-backend-searchcast.
