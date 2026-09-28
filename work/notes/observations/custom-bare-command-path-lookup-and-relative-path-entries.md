# custom backend bare-command PATH lookup can still hit the cwd via relative PATH entries

2026-09-28, seen while doing config-trust-layers. A bare `custom` command name (no slash) keeps its `PATH` lookup (`packages/webveil/src/core/backends/custom.ts`), and `spawn` inherits the process cwd, so a `PATH` containing `.` or another relative entry would resolve the command inside the cwd, which a cloned repository controls. Only matters on a misconfigured `PATH`; not addressed by the trust task.
