# incur 0.4.10 `--mcp` breaks against @modelcontextprotocol/server alpha.3

2026-06-26, `incur@0.4.10` declares `@modelcontextprotocol/server@^2.0.0-alpha.2`,
but the published `2.0.0-alpha.3` is a breaking prerelease that moved
`StdioServerTransport` out of the package's main entry to its `./stdio` subpath.
incur's `dist/Mcp.js` still does `await import('@modelcontextprotocol/server')` and
reads `StdioServerTransport` off the root, so `webveil --mcp` throws
`TypeError: StdioServerTransport is not a constructor` whenever the resolver picks
alpha.3.

## Fix shipped (for consumers, not just the workspace)

The root `pnpm.overrides` pin alone does NOT travel to consumers who install
`webveil` from npm (overrides are workspace-only). Since the SDK is a TRANSITIVE
dep via incur (incur declares `^2.0.0-alpha.2`, which `^` lets float to the broken
alpha.3), the durable fix is to make the PUBLISHED `webveil` package constrain it:
`@modelcontextprotocol/server` is now a DIRECT dependency of `packages/webveil`
pinned to `2.0.0-alpha.2` (a direct pin beats the transitive `^` range at install),
so a consumer's `webveil --mcp` resolves the working SDK. The workspace override is
kept too. `pi-webveil` is unaffected (it does not import incur).

Revisit (drop BOTH the direct pin and the override) when a newer incur imports the
SDK's `./stdio` subpath. `0.4.10` is currently the latest incur, so there is no
fixed incur to upgrade to yet, track incur releases.

## Upstream report

Filing an issue on the incur repo (see the proposed title/body the maintainer is
posting). If already reported, add a comment with the `./stdio` subpath detail.
