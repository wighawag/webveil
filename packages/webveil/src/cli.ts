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
// The setup commands (`install-libcurl`, `install-recipes`, `recipes`,
// `doctor`) live in setup.ts, which loads serpcast's install code lazily; they
// are CLI only: the `--mcp` server is built without them (see setup.ts).
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
import {closeBackends} from './core/backends/registry.js';
import {clearSerpcastState} from './core/backends/serpcast.js';
import {
	UsageError,
	doctor,
	installLibcurl,
	installRecipes,
	listRecipes,
} from './setup.js';
import type {SetupDeps} from './setup.js';

/**
 * The two core functions the frontend wraps, seamed so tests can inject fakes.
 * Defaults are the real core; a test passes spies to assert the wiring.
 */
export interface CliDeps {
	search?: typeof coreSearch;
	fetch?: typeof coreFetch;
	clearState?: typeof clearSerpcastState;
	/** Seams of the setup commands (install API, progress sink, config). */
	setup?: SetupDeps;
}

/** How the CLI is built: `setupCommands: false` leaves out the setup commands. */
export interface CliOptions {
	/**
	 * Include `install-libcurl`, `install-recipes`, `recipes` and `doctor`
	 * (default true). The bin builds the `--mcp` server without them: they are
	 * CLI only (setup.ts, recorded decisions).
	 */
	setupCommands?: boolean;
}

const PROXY_HELP =
	'Download through this proxy (http://, socks5://, socks5h://; socks5h:// ' +
	'resolves host names at the proxy, e.g. socks5h://127.0.0.1:9050 for Tor). ' +
	'Never the configured egress by default: with a direct egress the download ' +
	'is direct, with a proxy egress (egress or fetchEgress) give --egress, ' +
	'--proxy or --direct, else it is refused (exit 2)';

const DIRECT_HELP =
	"Download from this machine's own IP. Required (or --egress or --proxy) " +
	'when the configured egress or fetchEgress is a proxy';

const EGRESS_HELP =
	'Download through the configured egress, resolved as for search (egress, ' +
	'else fetchEgress when only that one is a proxy; SOCKS as socks5h://), ' +
	'credentials included but never printed. Direct when every hop is direct';

/** Run an install command, turning a `UsageError` into an exit-2 error. */
async function withUsage<T>(
	c: {
		error(e: {code: string; message: string; exitCode: number}): never;
	},
	fn: () => Promise<T>,
): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		return c.error({
			code: error.code,
			message: error.message,
			exitCode: error.exitCode,
		});
	}
}

/** The size presets `fetch` accepts, mirroring the core's `FetchSize`. */
const SIZES = ['s', 'm', 'l', 'f'] as const;

/**
 * Build the webveil CLI. Returns the incur `Cli` so a caller (the bin below, or
 * a test) decides how to serve it. The `search`/`fetch` commands forward to the
 * injected core, normalizing nothing themselves — the core already deduped,
 * clamped, and size-bounded.
 */
export function createCli(deps: CliDeps = {}, options: CliOptions = {}) {
	const search = deps.search ?? coreSearch;
	const fetch = deps.fetch ?? coreFetch;
	const clearState = deps.clearState ?? clearSerpcastState;

	// Recorded decision (task identity-partitioned-state-store): `state clear`
	// is a `state` group (room for later state verbs) and, like every command,
	// also an MCP tool: clearing only drops sessions, so an agent may do it.
	// Alternative: a CLI-only flag on `search`, rejected as mixing two jobs.
	const state = Cli.create('state', {
		description: 'Persisted serpcast state (sessions, cooldowns) per identity.',
	}).command('clear', {
		description:
			"Clear the current identity's state (this folder's egress and serpcast config), or every identity with --all.",
		options: z.object({
			all: z.boolean().optional().describe('Clear every identity'),
		}),
		async run(c) {
			return {cleared: await clearState({all: c.options.all})};
		},
	});

	const cli = Cli.create('webveil', {
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
				// Engine-degradation surfacing: results carrying `unresponsiveEngines`
				// (some engines down, others answered) get the flag hoisted to the
				// top level too, so MCP/terminal consumers see it without scanning
				// every hit.
				const unresponsiveEngines = results.find(
					(r) => r.unresponsiveEngines !== undefined,
				)?.unresponsiveEngines;
				return unresponsiveEngines ? {results, unresponsiveEngines} : {results};
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
		})
		.command(state);
	if (options.setupCommands === false) return cli;
	const setup = deps.setup ?? {};
	return cli
		.command('install-libcurl', {
			description:
				'Download the pinned libcurl-impersonate release, verify its sha256 and ' +
				"install it in serpcast's data directory (~/.local/share/serpcast), " +
				'where webveil finds it. Runs only when you type it.',
			options: z.object({
				egress: z.boolean().optional().describe(EGRESS_HELP),
				proxy: z.string().optional().describe(PROXY_HELP),
				direct: z.boolean().optional().describe(DIRECT_HELP),
				force: z
					.boolean()
					.optional()
					.describe('Replace a differing library already installed'),
			}),
			async run(c) {
				return withUsage(c, () => installLibcurl(c.options, setup));
			},
		})
		.command('install-recipes', {
			description:
				'Install a recipe set from a release archive (URL or file), pinned by ' +
				'its sha256, into ~/.local/share/serpcast/recipes/<set>; name it in ' +
				'config as set:<set>. A set may hold code recipes: the pin is your ' +
				'trust decision.',
			args: z.object({
				source: z.string().describe('The archive: an http(s) URL or a file'),
			}),
			options: z.object({
				sha256: z.string().describe("The archive's sha256 (hex), required"),
				name: z
					.string()
					.optional()
					.describe("The set's name (default: the archive's manifest name)"),
				egress: z
					.boolean()
					.optional()
					.describe(`${EGRESS_HELP}. Ignored for a local file`),
				proxy: z.string().optional().describe(PROXY_HELP),
				direct: z
					.boolean()
					.optional()
					.describe(
						`${DIRECT_HELP}. A local file makes no request and needs neither`,
					),
				force: z
					.boolean()
					.optional()
					.describe('Replace a differing set already installed'),
			}),
			async run(c) {
				return withUsage(c, () =>
					installRecipes(c.args.source, c.options, setup),
				);
			},
		})
		.command('recipes', {
			description:
				'List the installed recipe sets, their source, sha256 and files.',
			async run() {
				return listRecipes(setup);
			},
		})
		.command('doctor', {
			description:
				'Check the libcurl-impersonate library webveil loads and this ' +
				"folder's config: backend, egress, fetch transport, engines and " +
				'their recipe files, recipe sets. No network unless --remote.',
			options: z.object({
				remote: z
					.boolean()
					.optional()
					.describe(
						'Ask a fingerprint echo service (tls.browserleaks.com) once, ' +
							'through the egress',
					),
			}),
			async run(c) {
				const result = await doctor({remote: c.options.remote}, setup);
				if (result.healthy) return result;
				return c.error({
					code: 'UNHEALTHY',
					message:
						`webveil doctor: not healthy: ${result.problems.join('; ')}\n` +
						JSON.stringify(result, null, 2),
					exitCode: 1,
				});
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

/**
 * Serve `argv` and release what backends keep across searches at PROCESS
 * level, never inside a command handler (under `--mcp` that would defeat the
 * serpcast instance cache). A one-shot command closes once served, so the
 * process exits on its own; the MCP server closes when its stdin ends or it
 * is signalled. incur exits the process itself on a failed command.
 */
export async function serveCli(
	target: {serve(argv?: string[]): Promise<void>},
	args: string[] = argv.slice(2),
	close: () => Promise<void> = closeBackends,
): Promise<void> {
	if (!args.includes('--mcp')) return target.serve(args).finally(close);
	process.stdin.once('end', () => void close());
	for (const [signal, code] of [
		['SIGINT', 130],
		['SIGTERM', 143],
	] as const)
		process.once(signal, () => void close().finally(() => process.exit(code)));
	return target.serve(args);
}

// The `--mcp` server is built without the setup commands (CliOptions).
if (isMain())
	void serveCli(
		argv.includes('--mcp') ? createCli({}, {setupCommands: false}) : cli,
	);

export default cli;
