# incur 0.4.10 `--mcp` breaks against @modelcontextprotocol/server alpha.3

2026-06-26 — `incur@0.4.10` declares `@modelcontextprotocol/server@^2.0.0-alpha.2`,
but the published `2.0.0-alpha.3` is a breaking prerelease that moved
`StdioServerTransport` out of the package's main entry to its `./stdio` subpath.
incur's `dist/Mcp.js` still does `await import('@modelcontextprotocol/server')` and
reads `StdioServerTransport` off the root, so `webveil --mcp` throws
`TypeError: StdioServerTransport is not a constructor` whenever the resolver picks
alpha.3. Worked around in the cli-incur-frontend task with a root pnpm override
pinning `@modelcontextprotocol/server` to `2.0.0-alpha.2`. Revisit (drop the
override) when a newer incur imports the SDK's `./stdio` subpath.
