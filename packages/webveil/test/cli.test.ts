// The incur CLI/MCP frontend wires its `search`/`fetch` commands to the SAME
// framework-agnostic core both frontends call. These tests assert that wiring
// WITHOUT any network: the core functions are injected as fakes (createCli
// deps), the CLI is served with custom argv + a captured stdout, and we assert
// the fake core was called with the parsed query/url/options and that its
// result reaches the output. `--mcp` is exercised over an in-memory stdio pair.

import {afterEach, describe, expect, it, vi} from 'vitest';
import {spawn, spawnSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCli, serveCli} from '../src/cli.js';
import type {SearchResult, FetchResult} from '../src/core/backends/types.js';
import {createStateStore, partitionDir, stateRoot} from '../src/core/state.js';

/** Serve the CLI with captured stdout and a no-op exit; returns stdout text. */
async function run(
	cli: ReturnType<typeof createCli>,
	argv: string[],
): Promise<string> {
	let out = '';
	await cli.serve(argv, {
		stdout(s) {
			out += s;
		},
		exit() {},
	});
	return out;
}

const hit: SearchResult = {title: 'Webveil', url: 'https://example.com/a'};
const page: FetchResult = {
	url: 'https://example.com/p',
	markdown: '# Example',
	truncated: false,
};

describe('webveil CLI — search command', () => {
	it('calls core.search with the positional query and returns its results', async () => {
		const search = vi.fn(async () => [hit]);
		const cli = createCli({search});
		const out = await run(cli, ['search', 'hello world']);

		expect(search).toHaveBeenCalledTimes(1);
		const [query] = search.mock.calls[0]!;
		expect(query).toBe('hello world');
		// The hit reaches the (TOON) output.
		expect(out).toContain('example.com/a');
		expect(out).toContain('Webveil');
	});

	it('forwards --maxResults (alias -n) to the core options', async () => {
		const search = vi.fn(async () => [hit]);
		const cli = createCli({search});
		await run(cli, ['search', 'q', '--maxResults', '3']);
		expect(search.mock.calls[0]![1]).toMatchObject({maxResults: 3});

		const search2 = vi.fn(async () => [hit]);
		await run(createCli({search: search2}), ['search', 'q', '-n', '5']);
		expect(search2.mock.calls[0]![1]).toMatchObject({maxResults: 5});
	});

	it('omits maxResults when not passed (core applies its own default)', async () => {
		const search = vi.fn(async () => [hit]);
		await run(createCli({search}), ['search', 'q']);
		expect(search.mock.calls[0]![1]?.maxResults).toBeUndefined();
	});

	it('does not call core.fetch for a search command', async () => {
		const search = vi.fn(async () => [hit]);
		const fetch = vi.fn(async () => page);
		await run(createCli({search, fetch}), ['search', 'q']);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('surfaces engine degradation (unresponsiveEngines) in the output', async () => {
		// Partial engine failure: results come back annotated, and the CLI
		// hoists the flag to the top level so MCP/terminal consumers see it.
		const search = vi.fn(async () => [
			{...hit, unresponsiveEngines: ['brave', 'duckduckgo']},
		]);
		const out = await run(createCli({search}), ['search', 'q']);
		expect(out).toContain('brave');
		expect(out).toContain('duckduckgo');
	});
});

describe('webveil CLI — fetch command', () => {
	it('calls core.fetch with the positional url and returns its markdown', async () => {
		const fetch = vi.fn(async () => page);
		const out = await run(createCli({fetch}), [
			'fetch',
			'https://example.com/p',
		]);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]![0]).toBe('https://example.com/p');
		expect(out).toContain('Example');
	});

	it('forwards the size flag (alias -s) to the core options', async () => {
		const fetch = vi.fn(async () => page);
		await run(createCli({fetch}), [
			'fetch',
			'https://example.com',
			'--size',
			'l',
		]);
		expect(fetch.mock.calls[0]![1]).toMatchObject({size: 'l'});

		const fetch2 = vi.fn(async () => page);
		await run(createCli({fetch: fetch2}), [
			'fetch',
			'https://example.com',
			'-s',
			'f',
		]);
		expect(fetch2.mock.calls[0]![1]).toMatchObject({size: 'f'});
	});

	it('rejects a size outside s|m|l|f (schema validation, core not called)', async () => {
		const fetch = vi.fn(async () => page);
		await run(createCli({fetch}), [
			'fetch',
			'https://example.com',
			'--size',
			'xl',
		]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('omits size when not passed (core applies the configured default)', async () => {
		const fetch = vi.fn(async () => page);
		await run(createCli({fetch}), ['fetch', 'https://example.com']);
		expect(fetch.mock.calls[0]![1]?.size).toBeUndefined();
	});
});

// The built bin (`dist/cli.js`) — the `webveil` entry the package.json `bin`
// points at. The verify gate runs `build` before `test`, so it exists; if a bare
// `vitest` runs without a prior build we skip rather than false-fail.
const BIN = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * Run the built bin as an MCP stdio server, do the JSON-RPC handshake, and
 * return the tool names from `tools/list`. This exercises the REAL `--mcp` path
 * end-to-end (the same definition served as an MCP server), over the bin's own
 * stdin/stdout — no network, no live backend (we never call a tool).
 */
function mcpToolNames(): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, '--mcp'], {
			stdio: ['pipe', 'pipe', 'inherit'],
		});
		let raw = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('--mcp server did not respond in time'));
		}, 10_000);
		child.stdout.on('data', (chunk: Buffer) => {
			raw += chunk.toString();
			for (const line of raw.split('\n')) {
				if (!line.trim()) continue;
				let msg: {id?: number; result?: {tools?: {name: string}[]}};
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg.id === 2) {
					clearTimeout(timer);
					child.kill();
					resolve((msg.result?.tools ?? []).map((t) => t.name));
					return;
				}
			}
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
		const send = (msg: unknown) =>
			child.stdin.write(JSON.stringify(msg) + '\n');
		send({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {name: 'test', version: '0'},
			},
		});
		send({jsonrpc: '2.0', method: 'notifications/initialized'});
		send({jsonrpc: '2.0', id: 2, method: 'tools/list'});
	});
}

describe('webveil CLI: state clear command', () => {
	it('clears the current identity by default and every identity with --all', async () => {
		const clearState = vi.fn(async () => ['a'.repeat(64)]);
		const out = await run(createCli({clearState}), ['state', 'clear']);
		expect(clearState.mock.calls[0]![0]).toEqual({all: undefined});
		expect(out).toContain('a'.repeat(64));
		await run(createCli({clearState}), ['state', 'clear', '--all']);
		expect(clearState.mock.calls[1]![0]).toEqual({all: true});
	});

	it('really removes every partition under XDG_STATE_HOME with --all', async () => {
		const id = 'c'.repeat(64);
		await createStateStore(partitionDir(id)).set('k', 1);
		expect(existsSync(partitionDir(id))).toBe(true);
		const out = await run(createCli(), ['state', 'clear', '--all']);
		expect(out).toContain(id);
		expect(existsSync(partitionDir(id))).toBe(false);
		expect(existsSync(stateRoot())).toBe(true);
	});
});

describe('webveil CLI — MCP frontend (--mcp)', () => {
	it.skipIf(!existsSync(BIN))(
		'exposes the same definition as an MCP server with search + fetch tools',
		async () => {
			const names = await mcpToolNames();
			expect(names).toContain('search');
			expect(names).toContain('fetch');
		},
	);
});

// `isMain()` regression: npm installs the bin as a `node_modules/.bin/webveil`
// SYMLINK, so `argv[1]` is the symlink while `import.meta.url` is the real
// `dist/cli.js`. A raw equality guard is false for every installed invocation
// and the CLI silently never serves (exit 0, no output). The fix resolves
// symlinks on both sides; this asserts the bin serves when launched via a
// symlink. We use `--help` so it needs no network/backend, only that the CLI
// actually runs (non-empty stdout).
describe('webveil CLI — bin entry through a symlink (isMain)', () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, {recursive: true, force: true});
	});

	it.skipIf(!existsSync(BIN))('serves when launched via a bin symlink', () => {
		dir = mkdtempSync(join(tmpdir(), 'webveil-bin-'));
		const link = join(dir, 'webveil');
		symlinkSync(BIN, link);
		const res = spawnSync(process.execPath, [link, '--help'], {
			encoding: 'utf8',
			timeout: 10_000,
		});
		expect(res.status).toBe(0);
		expect(res.stdout.length).toBeGreaterThan(0);
		expect(res.stdout).toContain('webveil');
	});
});

// Process-level close: `serveCli` releases cached backend state (the serpcast
// instance) AFTER a one-shot command is served, never inside the handler.
describe('webveil CLI: serveCli closes backends at process level', () => {
	it('closes after the one-shot command has printed', async () => {
		const events: string[] = [];
		const target = {
			async serve(args?: string[]) {
				events.push(`serve ${args?.join(' ')}`);
			},
		};
		await serveCli(target, ['search', 'q'], async () => {
			events.push('close');
		});
		expect(events).toEqual(['serve search q', 'close']);
	});

	it('closes even when serving fails', async () => {
		const close = vi.fn(async () => {});
		const target = {serve: () => Promise.reject(new Error('boom'))};
		await expect(serveCli(target, ['search', 'q'], close)).rejects.toThrow(
			'boom',
		);
		expect(close).toHaveBeenCalledTimes(1);
	});

	// The built entry, in a real process: a cached serpcast instance that holds
	// a handle (like a library-mode browser) until closed. The process must
	// exit on its own after printing, which it only can if the instance is
	// closed at process level by `serveCli` + `closeBackends`.
	const script = (closeArg: string) => `
		import {createCli, createSerpcastBackend, search, serveCli} from ${JSON.stringify(
			new URL('../dist/index.js', import.meta.url).href,
		)};
		const create = () => {
			const handle = setInterval(() => {}, 1000);
			return {
				search: async () => ({results: [{title: 'Hit', url: 'https://example.com/hit'}], engine: 'e', failures: []}),
				clearSessions: async () => {},
				close: async () => clearInterval(handle),
			};
		};
		const config = {backend: 'serpcast', baseUrl: 'http://127.0.0.1:8080', egress: {mode: 'direct'}, fetchSize: 'm', serpcast: {engines: ['e'], recipes: [process.argv[1]]}};
		const cli = createCli({
			search: (q, o) => search(q, o, {
				resolveConfig: () => config,
				getBackend: (_n, c) => createSerpcastBackend(c, {createSerpcast: create}),
			}),
		});
		await serveCli(cli, ['search', 'q']${closeArg});
	`;

	function runScript(closeArg: string, timeout: number) {
		dir = mkdtempSync(join(tmpdir(), 'webveil-oneshot-'));
		writeFileSync(
			join(dir, 'e.json'),
			JSON.stringify({
				navigate: {url: 'https://e.test/?q={query}'},
				ready: '.r',
				results: {item: '.r', fields: {title: {}, url: {attr: 'href'}}},
			}),
		);
		return spawnSync(
			process.execPath,
			['--input-type=module', '-e', script(closeArg), dir],
			{encoding: 'utf8', timeout},
		);
	}
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, {recursive: true, force: true});
	});

	it.skipIf(!existsSync(BIN))(
		'a one-shot search exits on its own after printing',
		() => {
			const res = runScript('', 4_000);
			expect(res.error).toBeUndefined(); // not killed by the timeout
			expect(res.status).toBe(0);
			expect(res.stdout).toContain('example.com/hit');
		},
	);

	it.skipIf(!existsSync(BIN))(
		'(control) without the process-level close it would hang',
		() => {
			const res = runScript(', async () => {}', 1_500);
			expect(res.stdout).toContain('example.com/hit');
			expect(res.signal).toBe('SIGTERM'); // killed by the timeout
		},
	);
});

// The real bin with the real serpcast and no libcurl-impersonate: strict mode
// refuses to search, the error carries the fix, and the process exits.
describe('webveil CLI: serpcast backend without libcurl-impersonate', () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, {recursive: true, force: true});
	});

	it.skipIf(!existsSync(BIN))('fails loud with the fix and exits', () => {
		dir = mkdtempSync(join(tmpdir(), 'webveil-nolib-'));
		mkdirSync(join(dir, 'recipes'));
		writeFileSync(
			join(dir, 'recipes', 'e.json'),
			JSON.stringify({
				navigate: {url: 'https://e.test/?q={query}'},
				ready: '.r',
				results: {item: '.r', fields: {title: {}, url: {attr: 'href'}}},
			}),
		);
		writeFileSync(
			join(dir, 'webveil.json'),
			JSON.stringify({
				backend: 'serpcast',
				serpcast: {engines: ['e'], recipes: ['recipes']},
			}),
		);
		const res = spawnSync(process.execPath, [BIN, 'search', 'q'], {
			cwd: dir,
			encoding: 'utf8',
			timeout: 10_000,
			env: {
				...process.env,
				XDG_CONFIG_HOME: join(dir, 'xdg'),
				WEBVEIL_SERPCAST_LIBCURL_PATH: join(dir, 'missing.so'),
			},
		});
		expect(res.status).toBe(1);
		expect(res.stdout).toContain('impersonation is not active');
		expect(res.stdout).toContain('webveil install-libcurl');
	});
});
