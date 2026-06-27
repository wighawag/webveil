# Config-file location: one neutral `webveil.json`, no `.pi/`

## Status

accepted (implemented)

## Context

webveil has ONE framework-agnostic core (`search()` / `fetch()`) behind TWO
frontends:

- the **CLI + MCP** (`packages/webveil`, the `webveil` bin), documented as
  **pi-agnostic**: usable from bash, Claude Code, Cursor, Codex, pi via
  `pi-mcp-adapter`, etc. Its `search`/`fetch` commands call the core WITHOUT a
  `cwd`, so `resolveConfig` falls back to `process.cwd()` (the shell directory).
- the **pi extension** (`packages/pi-webveil`), which calls the core in-process
  and passes `{cwd: ctx.cwd}` (pi's session working directory).

The config seam (`packages/webveil/src/core/config.ts`, `resolveConfig`)
currently resolves, highest wins:

```
env (WEBVEIL_*)
  > nearest .pi/webveil.json walking UP from cwd   (PROJECT_FILE, first found wins)
  > global ~/.pi/agent/webveil.json
  > defaults
```

(Verified against `config.ts` @ HEAD: `PROJECT_FILE = join('.pi','webveil.json')`,
`globalPath = join(homedir(),'.pi','agent','webveil.json')`. Defaults:
`backend:'searxng'`, `baseUrl:'http://127.0.0.1:8080'`, `egress:{mode:'direct'}`,
`fetchSize:'m'`. Layering is a per-key `Object.assign` of partials, lowest-first.)

### The problem

The only non-env, non-global way to configure webveil per project is to create
`.pi/webveil.json`, a directory named after **pi**, inside what may be a
**non-pi** project. For a tool we advertise as pi-agnostic, requiring a `.pi/`
directory to configure the CLI is incoherent: a Cursor/Codex/bash user has no
other reason for a `.pi/` directory to exist, and the pi naming leaks a frontend
detail into the neutral core's public contract. The same applies to the global
`~/.pi/agent/` path.

The framing that prompted this ADR is correct on all checked points: the CLI
does not pass `cwd`; `.pi/webveil.json` is the hardcoded project file; the global
is hardcoded under `~/.pi/agent/`; the resolution is unit-tested in
`packages/webveil/test/config.test.ts`. (The CLI falling back to `process.cwd()`
is itself fine, that is the right default for a CLI; the issue is purely the
filename/dir it looks for.)

### Scope decision (per maintainer): no back-compat, drop `.pi/` entirely

webveil is pre-1.0 and the `.pi/` paths are not a contract we owe anyone. So this
ADR does NOT carry the old paths forward:

- `.pi/webveil.json` and `~/.pi/agent/webveil.json` are REMOVED, not aliased.
- The **pi extension does not read `.pi/` either.** Both frontends use the same
  single neutral name. The extension still passes `ctx.cwd`; it just resolves the
  neutral file like everyone else.

This trades a one-time "move your file" for a clean, frontend-neutral contract
with zero candidate-list or deprecation machinery.

### Prior art

- **Frontend-neutral config at project root** is the dominant convention for
  project-scoped tool config (`tsconfig.json`, `.prettierrc`, `.editorconfig`,
  `.npmrc`). None nest under a vendor/agent directory; the tool owns a name at
  the repo root.
- **Walking UP from cwd to the nearest config** is what prettier, eslint, git,
  ripgrep, etc. do, so a single config at the repo root applies when you run the
  tool from a nested subdirectory.

## Decision

### 1. Project file: a single neutral name, walk up, first found wins

```
webveil.json
```

Resolve it by walking UP from `cwd` (unchanged walk shape), reading the first
`webveil.json` found; that directory wins entirely. One filename, so there is no
per-directory candidate list and no same-directory tie to break.

**Keep the walk-up** (do not collapse to cwd-only). The walk is what makes a
single `repo/webveil.json` usable when webveil is run from `repo/packages/x/`,
which is the common case (a developer's shell, or pi's session cwd, sits in a
subdir of the project that owns the config). It is one `stat` per ancestor level,
cheap, and matches every comparable tool. Collapsing to cwd-only would silently
give nested directories defaults+env unless each carried its own file, a footgun
for no real simplification. The complexity the prior draft worried about came
from a multi-name candidate list, NOT from the walk; with a single filename the
walk is trivial.

A single neutral name is enough (the maintainer's instinct is right): once the
name is neutral and read by both frontends, there is nothing the extra dotfile
variants (`.webveil.json`, `.config/webveil.json`) buy that justifies the extra
stats and a fuzzier contract. Pick one name and document it.

### 2. Global file: XDG

```
$XDG_CONFIG_HOME/webveil/config.json   (if XDG_CONFIG_HOME set)
~/.config/webveil/config.json          (XDG default)
```

First existing wins. `options.globalPath`, when explicitly provided (the tests
do this), still wins outright and short-circuits, preserving test isolation of
the real home directory.

### 3. Precedence (deterministic, documented)

Layer order is unchanged; only the filenames/locations change. Highest wins:

```
env (WEBVEIL_*)
  > project  = nearest `webveil.json` walking up from cwd (first found wins)
  > global   = $XDG_CONFIG_HOME/webveil/config.json
               (or ~/.config/webveil/config.json; or options.globalPath if given)
  > defaults
```

Collision rules:

- There is no same-directory collision to resolve (one filename).
- Across the walk, the NEAREST directory's `webveil.json` wins entirely
  (existing "nearest project file wins" semantics, preserved).
- Layering BETWEEN env/project/global/defaults stays per-key `Object.assign`
  (partials fill gaps), exactly as today.

## Why this shape

- **One neutral name, both frontends.** No CLI-vs-extension divergence, no
  candidate list, no `.pi/`. The extension passing `ctx.cwd` keeps "per folder =
  per account/egress" intact; it just resolves `webveil.json`.
- **Walk-up kept, single name.** Keeps the actually-useful behavior (repo-root
  config applies from subdirectories) while shedding the only thing that made it
  complex (multiple candidate filenames).
- **XDG for the global** aligns the user-level file with cross-tool convention.

## Rejected alternatives

- **Keep `.pi/` as a back-compat alias.** Explicitly declined by the maintainer;
  pre-1.0, the old paths are not a contract. Carrying them would add a candidate
  list and deprecation wording for no benefit.
- **Per-frontend divergence** (extension reads `.pi/`, CLI reads `webveil.json`).
  Splits the contract and needs two code paths. Rejected; both read one name.
- **cwd-only, no walk.** Simpler by one loop, but breaks the common run-from-a-
  subdir case and offers no meaningful simplification now that there is a single
  filename. Rejected.
- **Multiple project candidate names** (`.webveil.json`, `.config/webveil.json`,
  ...). Extra stats, fuzzier contract, no real gain. Rejected; one name.

## Consequences

- Change is confined to the config seam, `core/config.ts`:
  - `PROJECT_FILE` becomes `'webveil.json'` (drop the `.pi/` join); the walk in
    `readProjectChain` is otherwise unchanged.
  - the global default changes from `~/.pi/agent/webveil.json` to an XDG resolver
    (`$XDG_CONFIG_HOME` → `~/.config`) producing `webveil/config.json`.
  - update the file's header comment (it documents the old precedence).
- No change to `search.ts` / `fetch.ts` or either frontend's code. The CLI keeps
  NOT passing `cwd`; the extension keeps passing `ctx.cwd`. Both now find the
  neutral file.
- **Module budget:** net LOC is roughly flat (one filename constant changes;
  the XDG resolver adds a few lines but there is no candidate-list machinery).
  `config.ts` stays under its ~80 ceiling. Re-check the README LOC table after.
- **Tests** (`packages/webveil/test/config.test.ts`): UPDATE the existing cases
  that write `.pi/webveil.json` to write `webveil.json` instead (back-compat is
  not being preserved, so these change rather than gain a sibling). Specifically:
  - the precedence, nearest-wins, and nested-walk cases swap `.pi/webveil.json`
    → `webveil.json`;
  - the "isolates the global path" case keeps using `options.globalPath`
    (unchanged, still the isolation seam);
  - ADD a global-resolution case driving XDG via injected inputs: the resolver
    must read `XDG_CONFIG_HOME`/home from INJECTABLE inputs (extend
    `ResolveOptions`, e.g. reuse the `env` it already takes for `XDG_CONFIG_HOME`,
    plus a `homeDir` seam) so the suite sets a temp `XDG_CONFIG_HOME` and never
    touches the real home, matching the existing isolation discipline.
- **Docs:** README (config-seam section, the `> or set baseUrl in .pi/...` hint,
  the per-folder `.pi/webveil.json` example) and CONTEXT.md's config-seam line
  must change to the new precedence and `webveil.json` / XDG paths. A short
  "moved from `.pi/webveil.json`" note in the README/CHANGELOG is courtesy, not a
  compat shim.

## Open question for the implementer

- Global leaf filename under XDG: `config.json` (chosen above,
  `~/.config/webveil/config.json`, the conventional XDG idiom) vs `webveil.json`.
  Pick one and document it; `config.json` is the more conventional XDG leaf.
