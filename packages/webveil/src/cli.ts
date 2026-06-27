#!/usr/bin/env node
// webveil — the incur-based CLI + MCP frontend. ONE `Cli.create()` definition
// yields the CLI, an MCP server (`--mcp`), skills (`skills add`), a `--llms`
// manifest, TOON output, and token pagination for free (incur). Pi-agnostic:
// any agent (pi via pi-mcp-adapter, Claude Code, Cursor, Codex, bash) consumes
// it the same way. The `webveil` bin points at the built `dist/cli.js`.
//
// This is the THIN frontend: each command only parses argv/options and calls
// the SAME framework-agnostic core (`search()` / `fetch()`) the pi extension
// calls. The core owns config/egress/backend/extraction; this file owns no
// network logic of its own.
//
// Testability: `createCli(deps)` takes the core functions as injectable deps so
// a test wires fakes and asserts the commands call the core (via `cli.serve`
// with custom argv/stdout) WITHOUT touching the network. The bottom of the file
// builds the real CLI and serves it when run as the bin.

import {realpathSync} from 'node:fs';
import {argv} from 'node:process';
import {fileURLToPath} from 'node:url';
import {Cli, z} from 'incur';
import {search as coreSearch} from './core/search.js';
import {fetch as coreFetch} from './core/fetch.js';

/**
 * The two core functions the frontend wraps, seamed so tests can inject fakes.
 * Defaults are the real core; a test passes spies to assert the wiring.
 */
export interface CliDeps {
	search?: typeof coreSearch;
	fetch?: typeof coreFetch;
}

/** The size presets `fetch` accepts, mirroring the core's `FetchSize`. */
const SIZES = ['s', 'm', 'l', 'f'] as const;

/**
 * Build the webveil CLI. Returns the incur `Cli` so a caller (the bin below, or
 * a test) decides how to serve it. The `search`/`fetch` commands forward to the
 * injected core, normalizing nothing themselves — the core already deduped,
 * clamped, and size-bounded.
 */
export function createCli(deps: CliDeps = {}) {
	const search = deps.search ?? coreSearch;
	const fetch = deps.fetch ?? coreFetch;

	return Cli.create('webveil', {
		description:
			'Anonymous-capable, self-hosted, account-free web search + fetch for agents.',
	})
		.command('search', {
			description: 'Search the web via the configured backend and egress.',
			args: z.object({
				query: z.string().describe('The search query'),
			}),
			options: z.object({
				maxResults: z.coerce
					.number()
					.optional()
					.describe('Maximum number of results to return'),
			}),
			alias: {maxResults: 'n'},
			async run(c) {
				const results = await search(c.args.query, {
					maxResults: c.options.maxResults,
				});
				return {results};
			},
		})
		.command('fetch', {
			description:
				'Fetch a URL as clean, size-bounded markdown via the configured egress.',
			args: z.object({
				url: z.string().describe('The URL to fetch'),
			}),
			options: z.object({
				size: z
					.enum(SIZES)
					.optional()
					.describe('Page-size budget preset: s | m | l | f'),
			}),
			alias: {size: 's'},
			async run(c) {
				return fetch(c.args.url, {size: c.options.size});
			},
		});
}

// The real CLI (also `export default` so `incur gen` can import it for typed
// CTAs). Serving is GUARDED to the bin entry below, so importing this module in
// a test never consumes `process.argv` or exits the process.
const cli = createCli();

/**
 * True when this module is the process entry (the `webveil` bin), not imported.
 * `argv[1]` is the launched path, which for an npm-installed bin is the
 * `node_modules/.bin/webveil` SYMLINK, while `import.meta.url` resolves to the
 * real `dist/cli.js`. Comparing them raw makes the guard false for every
 * installed invocation (the CLI silently never serves). So resolve symlinks on
 * BOTH sides (`realpathSync`) before comparing.
 */
function isMain(): boolean {
	const entry = argv[1];
	if (!entry) return false;
	try {
		const self = fileURLToPath(import.meta.url);
		return realpathSync(self) === realpathSync(entry);
	} catch {
		return false;
	}
}

if (isMain()) cli.serve();

export default cli;
