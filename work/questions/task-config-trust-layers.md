<!-- dorfl-sidecar: item=task:config-trust-layers type=task slug=config-trust-layers allAnswered=false -->

## Q1

**'task:config-trust-layers' was bounced — how should we proceed?**

> acceptance gate failed (exit 1) on the rebased tip — the failing step was: `pnpm format:check && pnpm build && pnpm test`; its last output was:
>
> - Expected
> + Received
> - false
> + true
>  ❯ test/copy-publish-assets.test.ts:74:60
>      72|
>      73|   // Nothing was created outside the fake repo root.
>      74|   expect(existsSync(join(dirname(fakeRepo), 'README.md'))).toBe(false);
>        |                                                            ^
>      75|  });
>      76|
> ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
>  Test Files  1 failed | 17 passed (18)
>       Tests  1 failed | 196 passed (197)
>    Start at  18:58:49
>    Duration  875ms (transform 1.51s, setup 0ms, import 3.65s, tests 869ms, environment 2ms)
> /tmp/dorfl-fresh-gate-Wxj5uS/tip/packages/webveil:
> [ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] webveil@0.4.0 test: `vitest run`
> Exit status 1
> [ELIFECYCLE] Test failed. See above for more details.

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
