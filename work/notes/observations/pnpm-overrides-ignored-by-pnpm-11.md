# `pnpm.overrides` in the root package.json is ignored by pnpm 11 (2026-09-29)

Every pnpm 11.25.0 command in this repo warns `The "pnpm" field in package.json is no longer read by pnpm ... "pnpm.overrides"`, so the `@modelcontextprotocol/server: 2.0.0-alpha.2` override in the root `package.json` has no effect (the lockfile has no `overrides:` section). It is harmless today only because `packages/webveil` pins that exact version directly; if the override still matters it belongs under `overrides:` in `pnpm-workspace.yaml`. Noticed while building `release-workflow-oidc`.
