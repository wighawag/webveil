// The incur CLI/MCP frontend wires its `search`/`fetch` commands to the SAME
// framework-agnostic core both frontends call. These tests assert that wiring
// WITHOUT any network: the core functions are injected as fakes (createCli
// deps), the CLI is served with custom argv + a captured stdout, and we assert
// the fake core was called with the parsed query/url/options and that its
// result reaches the output. `--mcp` is exercised over an in-memory stdio pair.

import {describe, expect, it, vi} from 'vitest';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createCli} from '../src/cli.js';
import type {SearchResult, FetchResult} from '../src/core/backends/types.js';

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
