---
title: Declare searchcast as an optional peer dependency of webveil without pulling it into installs
slug: searchcast-optional-peer-dependency
spec: serpcast-backend
blockedBy: [release-workflow-oidc]
covers: []
---

## What to build

The serpcast backend imports `searchcast` itself for library-mode browser engines (`importSearchcast` in `packages/webveil/src/core/backends/serpcast.ts`), but `packages/webveil/package.json` does not declare it, so under a strict pnpm layout (or any package manager that does not hoist) it is not resolvable from webveil (observation `work/notes/observations/searchcast-not-declared-as-optional-peer.md`, resolved and deleted by this task). Declare it as an optional peer: `peerDependencies: {"searchcast": ">=0.1.1"}` with `peerDependenciesMeta.searchcast.optional: true`. The earlier attempt was reverted because this workspace's pnpm auto-installs peers, which pulled `searchcast` into the dev tree and the lockfile; stop that with `autoInstallPeers: false` in `pnpm-workspace.yaml` (pnpm 11 reads settings there) or an equivalent, scoped as narrowly as possible, and confirm other peers in the workspace still resolve (for example pi's peer deps of `pi-webveil`). Tests keep injecting the module through the existing seam; one test still asserts the clear "npm install searchcast" error when the package is absent.

## Acceptance criteria

- [ ] `webveil`'s manifest declares `searchcast` as an optional peer dependency; `pnpm install` does not install searchcast and the lockfile does not gain it.
- [ ] Every other peer dependency in the workspace still resolves; the verify gate passes.
- [ ] `pnpm pack --dry-run` of webveil shows the peer entry in the packed manifest.
- [ ] README's searchcast section says to install `searchcast` next to webveil for library mode (it may already); the observation is deleted.

## Blocked by

- release-workflow-oidc (serialized: both edit manifests and workspace config)

## Prompt

FIRST, check this task against current reality. RECORD non-obvious decisions (the pnpm setting and its scope).
