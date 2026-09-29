---
title: webveil imports searchcast without declaring it as an optional peer dependency
slug: searchcast-not-declared-as-optional-peer
---

2026-09-29, from task `searchcast-fallback-and-guard`. The serpcast backend imports `searchcast` itself (`importSearchcast` in `packages/webveil/src/core/backends/serpcast.ts`), resolved from webveil's own location. That works with npm's flat and global layouts, but under a strict pnpm layout an undeclared package is not resolvable from webveil. Declaring it as an optional `peerDependencies` entry was tried and reverted: this workspace's pnpm auto-installs peers, which pulled `searchcast` into the dev tree and the lockfile. A follow-up could declare it together with `auto-install-peers=false` (or a `pnpm.peerDependencyRules` entry).
