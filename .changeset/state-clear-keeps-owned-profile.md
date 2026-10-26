---
'webveil': minor
---

`webveil state clear` (and the `state_clear` MCP tool) no longer deletes a persistent browser profile another live webveil process owns: that partition is cleared of everything else and reported under a new `kept` list (`{identity, pid}`) with a hint. The new `--force` option (MCP: `force`) removes everything as before. Library: `clearState` and `clearSearchcastState` now return `{cleared, kept}` instead of the bare identity list, and `clearState` takes an options object (`{force, lock}`) as its third argument.
