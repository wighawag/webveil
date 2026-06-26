---
title: README with per-module LOC table + publish hygiene (copy README/LICENSE, package metadata)
slug: readme-loc-and-publish-hygiene
blockedBy: [cli-incur-frontend, pi-webveil-extension]
covers: []
---

## What to build

A self-contained chore (no prd story): the project README + publish hygiene across the
monorepo.

- **README + LOC table** — a root `README.md` documenting webveil, with the per-module
  LOC table (the first-class quality signal from `CONTEXT.md`) reflecting the modules as
  actually built. Fill the table from the real files now that the core + frontends exist.
- **Publish-copy of README/LICENSE** — on publish, copy the root `README.md` and `LICENSE`
  into EACH package (`packages/webveil`, `packages/pi-webveil`) so the published packages
  carry them, then add the copied `README.md` + `LICENSE` to each package's `.gitignore`
  (they are generated artifacts, not source). Wire this into the publish/prepack flow (a
  `prepack`/`prepublishOnly` script) so it is automatic, not manual.
- **Package metadata** — add `repository` (git@github.com:wighawag/webveil.git →
  the standard `repository.url`/`directory` form), `homepage`, `bugs`, `author`, and any
  other standard npm metadata to BOTH package manifests (and the root where appropriate),
  consistent with the existing `license`/`keywords`/`publishConfig`.

## Acceptance criteria

- [ ] Root `README.md` exists and includes a per-module LOC table reflecting the built
      modules.
- [ ] On publish/pack, `README.md` and `LICENSE` are copied into each package; both are
      gitignored in each package (generated, not committed).
- [ ] Both package manifests carry `repository` (with `directory`), `homepage`, `bugs`,
      and `author`, consistent with the existing metadata.
- [ ] The copy step is wired into the publish flow (e.g. `prepack`/`prepublishOnly`), runs
      cleanly, and does not commit the generated files.
- [ ] If the copy script runs in tests, it writes only within the repo's own
      packages (no shared/global location) — assert nothing outside the repo is touched.

## Blocked by

- `cli-incur-frontend` and `pi-webveil-extension` — the LOC table reflects the FINISHED
  modules, so build the README/LOC after both frontends land.

## Prompt

> A self-contained chore: write webveil's root `README.md` (with the per-module LOC table
> that `CONTEXT.md` treats as a first-class quality signal, filled from the real built
> files), and set up publish hygiene across the pnpm monorepo. Read `CONTEXT.md` (size
> discipline / LOC table, stack) and the existing package manifests.
>
> Publish hygiene: on publish/pack, COPY the root `README.md` + `LICENSE` into each package
> (`packages/webveil`, `packages/pi-webveil`) and gitignore the copies in each package
> (they are generated, not source). Wire it into a `prepack`/`prepublishOnly` script so it
> is automatic. Add standard npm metadata to both manifests: `repository` (url
> `git+https://github.com/wighawag/webveil.git` with the package `directory`), `homepage`,
> `bugs`, `author`, consistent with the existing `license`/`keywords`/`publishConfig`.
>
> Done = README + LOC table exist, the copy-on-publish step works and the copies are
> gitignored, and both manifests carry the metadata, with a green verify gate. If a script
> writes files, keep it inside the repo and assert no shared/global location is touched.
> FIRST check against current reality (the built module list); RECORD non-obvious in-scope
> decisions.
