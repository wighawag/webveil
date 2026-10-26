// The incur CLI/MCP frontend wires its `search`/`fetch` commands to the SAME
// framework-agnostic core both frontends call. These tests assert that wiring
// WITHOUT any network: the core functions are injected as fakes (createCli
// deps), the CLI is served with custom argv + a captured stdout, and we assert
// the fake core was called with the parsed query/url/options and that its
// result reaches the output. `--mcp` is exercised over an in-memory stdio pair.

import {afterEach, describe, expect, it, vi} from 'vitest';
import {spawn, spawnSync} from 'node:child_process';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
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

describe('webveil CLI: search command', () => {
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
			{...hit, unresponsiveEngines: ['engine-b', 'engine-c']},
		]);
		const out = await run(createCli({search}), ['search', 'q']);
		expect(out).toContain('engine-b');
		expect(out).toContain('engine-c');
	});
});

describe('webveil CLI: fetch command', () => {
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

// The built bin (`dist/cli.js`): the `webveil` entry the package.json `bin`
// points at. The verify gate runs `build` before `test`, so it exists; if a bare
// `vitest` runs without a prior build we skip rather than false-fail.
const BIN = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * Run the built bin as an MCP stdio server, do the JSON-RPC handshake, send
 * `requests` (ids 2, 3, ...) and resolve with their results in order. This
 * exercises the REAL `--mcp` path end-to-end (the same definition served as an
 * MCP server), over the bin's own stdin/stdout.
 */
function mcpExchange(
	requests: {method: string; params?: unknown}[],
	options: {cwd?: string; env?: NodeJS.ProcessEnv} = {},
): Promise<unknown[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, '--mcp'], {
			stdio: ['pipe', 'pipe', 'inherit'],
			cwd: options.cwd,
			env: options.env ?? process.env,
		});
		const results = new Map<number, unknown>();
		let buffer = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('--mcp server did not respond in time'));
		}, 10_000);
		child.stdout.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop()!;
			for (const line of lines) {
				if (!line.trim()) continue;
				let msg: {id?: number; result?: unknown; error?: unknown};
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg.id === undefined || msg.id < 2) continue;
				results.set(msg.id, msg.result ?? {error: msg.error});
			}
			if (results.size === requests.length) {
				clearTimeout(timer);
				child.kill();
				resolve(requests.map((_, i) => results.get(i + 2)));
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
		requests.forEach((request, i) =>
			send({jsonrpc: '2.0', id: i + 2, ...request}),
		);
	});
}

/** The tool names from `tools/list` (no tool is called: no backend needed). */
async function mcpToolNames(): Promise<string[]> {
	const [list] = (await mcpExchange([{method: 'tools/list'}])) as [
		{tools?: {name: string}[]},
	];
	return (list.tools ?? []).map((t) => t.name);
}

/** A local HTTP server answering every request with `body` (JSON); logs URLs. */
async function fakeServer(
	body: unknown,
): Promise<{url: string; requests: string[]; close(): Promise<void>}> {
	const requests: string[] = [];
	const server: Server = createServer((req, res) => {
		requests.push(req.url ?? '');
		res.writeHead(200, {'content-type': 'application/json'});
		res.end(JSON.stringify(body));
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const {port} = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		close: () => new Promise<void>((r) => server.close(() => r())),
	};
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

describe('webveil CLI: MCP frontend (--mcp)', () => {
	it.skipIf(!existsSync(BIN))(
		'exposes the same definition as an MCP server with search + fetch tools',
		async () => {
			const names = await mcpToolNames();
			expect(names).toContain('search');
			expect(names).toContain('fetch');
		},
	);

	// incur >= 0.4.15 defaults to progressive discovery (`search_tools`, ...);
	// webveil keeps each command as its own tool (cli.ts, `discovery: 'direct'`).
	it.skipIf(!existsSync(BIN))(
		'serves each command as its own tool, not incur discovery tools',
		async () => {
			expect((await mcpToolNames()).sort()).toEqual([
				'fetch',
				'search',
				'state_clear',
			]);
		},
	);

	let dir: string | undefined;
	let backend: Awaited<ReturnType<typeof fakeServer>> | undefined;
	afterEach(async () => {
		await backend?.close();
		if (dir) rmSync(dir, {recursive: true, force: true});
		backend = dir = undefined;
	});

	it.skipIf(!existsSync(BIN))(
		'answers a `search` tool call from the configured backend (a fake SearXNG)',
		async () => {
			backend = await fakeServer({
				results: [
					{url: 'https://example.com/mcp-hit', title: 'MCP hit', content: 'x'},
				],
			});
			dir = mkdtempSync(join(tmpdir(), 'webveil-mcp-'));
			writeFileSync(
				join(dir, 'webveil.json'),
				JSON.stringify({backend: 'searxng', baseUrl: backend.url}),
			);
			const env = Object.fromEntries(
				Object.entries(process.env).filter(([k]) => !k.startsWith('WEBVEIL_')),
			);
			const [result] = (await mcpExchange(
				[
					{
						method: 'tools/call',
						params: {name: 'search', arguments: {query: 'webveil mcp'}},
					},
				],
				{
					cwd: dir,
					env: {
						...env,
						XDG_CONFIG_HOME: join(dir, 'xdg'),
						XDG_STATE_HOME: join(dir, 'state'),
					},
				},
			)) as [{isError?: boolean; content?: {text: string}[]}];
			expect(result.isError).not.toBe(true);
			expect(JSON.stringify(result.content)).toContain(
				'https://example.com/mcp-hit',
			);
			expect(backend.requests).toHaveLength(1);
			expect(backend.requests[0]).toContain('q=webveil+mcp');
		},
	);
});

// The incur surfaces besides the commands, on the built bin: help, the LLM
// manifest, the skills listing, and no update check of its own.
describe('webveil CLI: incur built-ins', () => {
	const bin = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
		spawnSync(process.execPath, [BIN, ...args], {
			encoding: 'utf8',
			timeout: 10_000,
			env,
		});

	it.skipIf(!existsSync(BIN))('--help lists the commands', () => {
		const res = bin(['--help']);
		expect(res.status).toBe(0);
		for (const name of ['search', 'fetch', 'state', 'doctor'])
			expect(res.stdout).toMatch(new RegExp(`^\\s+${name}\\s`, 'm'));
		const search = bin(['search', '--help']);
		expect(search.status).toBe(0);
		expect(search.stdout).toContain('Usage: webveil search <query>');
	});

	it.skipIf(!existsSync(BIN))('--llms prints the manifest', () => {
		const res = bin(['--llms']);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('`webveil search <query>`');
		expect(res.stdout).toContain('`webveil fetch <url>`');
		expect(res.stdout).toContain('`webveil state clear`');
	});

	it.skipIf(!existsSync(BIN))('skills list names the generated skills', () => {
		const res = bin(['skills', 'list']);
		expect(res.status).toBe(0);
		expect(res.stdout).toContain('webveil-search');
		expect(res.stdout).toContain('webveil-fetch');
	});

	// incur >= 0.4.21 refreshes its update cache in a detached copy of the bin
	// started with this hidden flag; it would ask the npm registry directly,
	// outside the egress. webveil turns it off (cli.ts, `update: false`).
	let registry: Awaited<ReturnType<typeof fakeServer>> | undefined;
	let dir: string | undefined;
	afterEach(async () => {
		await registry?.close();
		if (dir) rmSync(dir, {recursive: true, force: true});
		registry = dir = undefined;
	});

	it.skipIf(!existsSync(BIN))(
		'never asks the npm registry for a newer version',
		async () => {
			registry = await fakeServer({'dist-tags': {latest: '999.0.0'}});
			dir = mkdtempSync(join(tmpdir(), 'webveil-update-'));
			const env = {
				...process.env,
				npm_config_registry: registry.url,
				XDG_CACHE_HOME: dir,
			};
			// Async spawn: the fake registry answers from this process.
			const status = await new Promise<number | null>((resolve) => {
				const child = spawn(process.execPath, [BIN, '--incur-update-check'], {
					env,
					stdio: 'ignore',
				});
				child.on('exit', resolve);
			});
			expect(status).toBe(0);
			expect(registry.requests).toEqual([]);
			expect(existsSync(join(dir, 'incur'))).toBe(false);
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
describe('webveil CLI: bin entry through a symlink (isMain)', () => {
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

// Process-level close: `serveCli` releases cached backend state (the searchcast
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

	// The built entry, in a real process: a cached searchcast instance that holds
	// a handle (like a library-mode browser) until closed. The process must
	// exit on its own after printing, which it only can if the instance is
	// closed at process level by `serveCli` + `closeBackends`.
	const script = (closeArg: string) => `
		import {createCli, createSearchcastBackend, search, serveCli} from ${JSON.stringify(
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
		const config = {backend: 'searchcast', baseUrl: 'http://127.0.0.1:8080', egress: {mode: 'direct'}, fetchSize: 'm', searchcast: {engines: ['e'], recipes: [process.argv[1]]}};
		const cli = createCli({
			search: (q, o) => search(q, o, {
				resolveConfig: () => config,
				getBackend: (_n, c) => createSearchcastBackend(c, {createSearchcast: create}),
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

// The real bin with the real searchcast and no libcurl-impersonate: strict mode
// refuses to search, the error carries the fix, and the process exits.
describe('webveil CLI: searchcast backend without libcurl-impersonate', () => {
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
				backend: 'searchcast',
				searchcast: {engines: ['e'], recipes: ['recipes']},
			}),
		);
		const res = spawnSync(process.execPath, [BIN, 'search', 'q'], {
			cwd: dir,
			encoding: 'utf8',
			timeout: 10_000,
			env: {
				...process.env,
				XDG_CONFIG_HOME: join(dir, 'xdg'),
				WEBVEIL_SEARCHCAST_LIBCURL_PATH: join(dir, 'missing.so'),
			},
		});
		expect(res.status).toBe(1);
		expect(res.stdout).toContain('impersonation is not active');
		expect(res.stdout).toContain('webveil install-libcurl');
	});
});

// The old `serpcast` spellings still work for one release: the real bin
// prints each warning once on stderr (stdout stays the command's output).
describe('webveil CLI: deprecated serpcast spellings', () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, {recursive: true, force: true});
	});

	it.skipIf(!existsSync(BIN))(
		'warns once per spelling on stderr and still uses the setting',
		() => {
			dir = mkdtempSync(join(tmpdir(), 'webveil-spellings-'));
			writeFileSync(
				join(dir, 'webveil.json'),
				JSON.stringify({backend: 'serpcast', serpcast: {engines: []}}),
			);
			const res = spawnSync(process.execPath, [BIN, 'search', 'q'], {
				cwd: dir,
				encoding: 'utf8',
				timeout: 10_000,
				env: {
					...process.env,
					XDG_CONFIG_HOME: join(dir, 'xdg'),
					WEBVEIL_SERPCAST_COOLDOWN_MS: '5',
				},
			});
			// The backend is searchcast: an empty chain (so not the default one, and
			// no network) is refused.
			expect(res.status).toBe(1);
			expect(res.stdout).toContain('set searchcast.engines');
			const lines = res.stderr
				.split('\n')
				.filter((l) => l.includes('deprecated'));
			expect(lines).toEqual([
				expect.stringContaining('use `searchcast` instead'),
				expect.stringContaining('use `backend: "searchcast"` instead'),
				expect.stringContaining('use WEBVEIL_SEARCHCAST_COOLDOWN_MS instead'),
			]);
			expect(res.stdout).not.toContain('deprecated');
		},
	);
});
