# serpcast is renamed searchcast in webveil; the old spellings are rewritten per config layer for one release

## Status

accepted

The engine layer of ADR 0004 was renamed and merged: `serpcast` is now `searchcast` 0.2, `serpcast-recipe` is `@searchcast/recipe`, and the browser runner is `@searchcast/browser` (searchcast's ADR 0005). webveil follows: the backend is `searchcast`, its config section `searchcast.*`, the browser runner's options `searchcast.browser.*` (not `searchcast.searchcast.*`, which names nothing), `fetchTransport: "searchcast"`, the fetch transport's section `fetchSearchcast.*`, and the env `WEBVEIL_SEARCHCAST_*`, `WEBVEIL_SEARCHCAST_BROWSER_*` and `WEBVEIL_FETCH_SEARCHCAST_*`. Read "serpcast" in ADR 0004 as searchcast; its decisions stand unchanged.

The webveil 0.10 spellings keep working for one release, each with one warning naming the new spelling, and are removed in the next minor. They are rewritten to the new spellings in each config layer (a config file's JSON, or the env) BEFORE the layers merge (`core/spellings.ts`), so provenance records the new key path and everything downstream sees one spelling only. That placement is the point of this decision: the trust rule (a project `webveil.json` cannot set an executable setting) keys on the new path, so `serpcast.codeRecipes` from a project file is refused as `searchcast.codeRecipes` is, with no second list of old key names to keep in sync; and the identity key hashes the same section whichever spelling supplied it. Both spellings of one setting in one layer is an error naming both, never a silent pick; across layers the usual precedence applies to the rewritten setting. The identity key also hashes the `browser` subsection under its 0.10 name, so the rename moves no identity to a new state partition.

## Considered Options

- **Accept both spellings downstream** (trust, identity, tunables and the backend each reading `serpcast` or `searchcast`): rejected; every check would need both key paths, and one forgotten old path in the executable-key list would let a project file set it.
- **Rename without accepting the old spellings**: rejected; a config file or env that worked in 0.10 would stop working (or, for an unused section, silently stop applying) on upgrade.
- **Pick one spelling silently when both are set**: rejected; the losing value would be ignored without a word, the failure mode the fail-loud rule forbids.

## Consequences

- Warnings are data on the resolved config: the CLI and MCP server print each once on stderr, pi-webveil shows each once (notification and tool result), and `webveil doctor` lists them as `deprecations`, a notice that does not make it unhealthy.
- The browser engine names `searchcast:<recipe>` in `engines` are values, not keys, and are unchanged. (Later renamed `browser:<recipe>` by task browser-engine-prefix, through the same per-layer rewrite: `core/spellings.ts`.)
- The exported library names (`createSerpcastBackend`, `SerpcastConfig`, ...) are renamed without aliases: they are code API, not configuration, and webveil is below 1.0.
