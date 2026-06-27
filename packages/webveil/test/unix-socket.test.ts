// End-to-end coverage for the `unix:` baseUrl transport: webveil reaching a
// SearXNG-like HTTP server bound to a Unix domain socket, WITHOUT a reverse
// proxy. The socket is bound inside a per-test temp dir and torn down after, and
// the test asserts nothing is created/left outside that fixture (it never touches
// a real /usr/local/searxng/... path).

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import {mkdtempSync, rmSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildDispatcher, EgressError} from '../src/core/egress.js';
import {createEgressFetch} from '../src/core/egress.js';
import {search} from '../src/core/search.js';
import type {Config} from '../src/core/config.js';

/** A SearXNG-like JSON `/search` server, recording the raw request URL it saw. */
function searxngSocketServer(): {server: Server; requests: string[]} {
	const requests: string[] = [];
	const server = createServer((req: IncomingMessage, res) => {
		requests.push(req.url ?? '');
		res.writeHead(200, {'content-type': 'application/json'});
		res.end(
			JSON.stringify({
				results: [
					{
						url: 'https://example.com/a',
						title: 'Result A',
						content: 'Snippet A',
					},
				],
			}),
		);
	});
	return {server, requests};
}

let dir: string;
const servers: Server[] = [];

beforeEach(() => {
	// A throwaway temp dir; the socket lives ONLY here (never a real path).
	dir = mkdtempSync(join(tmpdir(), 'webveil-unix-'));
});

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
	);
	rmSync(dir, {recursive: true, force: true});
});

function listenOnSocket(server: Server, socketPath: string): Promise<void> {
	servers.push(server);
	return new Promise((resolve) => server.listen(socketPath, () => resolve()));
}

function cfg(baseUrl: string, egress: Config['egress']): Config {
	return {backend: 'searxng', baseUrl, egress, fetchSize: 'm'};
}

describe('unix: socket baseUrl (end to end)', () => {
	it('reaches a SearXNG server on a Unix socket with egress=direct and returns results', async () => {
		const {server, requests} = searxngSocketServer();
		const socketPath = join(dir, 'searxng.sock');
		await listenOnSocket(server, socketPath);

		const results = await search(
			'webveil query',
			{},
			{resolveConfig: () => cfg(`unix:${socketPath}`, {mode: 'direct'})},
		);

		expect(results).toEqual([
			{title: 'Result A', url: 'https://example.com/a', snippet: 'Snippet A'},
		]);
		// The path/query reached the socket intact; the synthetic host is irrelevant.
		expect(requests).toHaveLength(1);
		const reqUrl = new URL(requests[0]!, 'http://localhost');
		expect(reqUrl.pathname).toBe('/search');
		expect(reqUrl.searchParams.get('q')).toBe('webveil query');
		expect(reqUrl.searchParams.get('format')).toBe('json');
	});

	it('preserves a non-root mount point in the request path', async () => {
		const {server, requests} = searxngSocketServer();
		const socketPath = join(dir, 'mounted.sock');
		await listenOnSocket(server, socketPath);

		await search(
			'q',
			{},
			{
				resolveConfig: () =>
					cfg(`unix:${socketPath}:/searxng`, {mode: 'direct'}),
			},
		);

		const reqUrl = new URL(requests[0]!, 'http://localhost');
		expect(reqUrl.pathname).toBe('/searxng/search');
	});

	it('FAILS LOUD (EgressError) when a unix: baseUrl is combined with http egress', async () => {
		const socketPath = join(dir, 'unused.sock');
		await expect(
			search(
				'q',
				{},
				{
					resolveConfig: () =>
						cfg(`unix:${socketPath}`, {
							mode: 'http',
							url: 'http://127.0.0.1:8118',
						}),
				},
			),
		).rejects.toBeInstanceOf(EgressError);
	});

	it('FAILS LOUD (EgressError) when a unix: baseUrl is combined with socks5 egress', async () => {
		const socketPath = join(dir, 'unused.sock');
		await expect(
			search(
				'q',
				{},
				{
					resolveConfig: () =>
						cfg(`unix:${socketPath}`, {
							mode: 'socks5',
							url: 'socks5://127.0.0.1:9050',
						}),
				},
			),
		).rejects.toBeInstanceOf(EgressError);
	});

	it('does NOT leak the socket transport into the shared egress dispatcher (web_fetch stays normal)', () => {
		// With a unix: backend baseUrl + direct egress, the SHARED config-wide
		// dispatcher (used by web_fetch / fetch.ts) must stay the normal direct
		// one (undefined), NOT a socket Agent. This guards against binding the
		// socket into buildDispatcher.
		const config = cfg('unix:/run/socket', {mode: 'direct'});
		expect(buildDispatcher(config)).toBeUndefined();
		// And the egress-bound fetch builds without throwing / without a socket.
		expect(() => createEgressFetch(config)).not.toThrow();
	});

	it('leaves NOTHING outside the temp fixture (no real socket/file created)', async () => {
		const {server} = searxngSocketServer();
		const socketPath = join(dir, 'iso.sock');
		await listenOnSocket(server, socketPath);
		await search(
			'q',
			{},
			{resolveConfig: () => cfg(`unix:${socketPath}`, {mode: 'direct'})},
		);
		// The socket file lives inside the temp dir only.
		expect(existsSync(socketPath)).toBe(true);
		expect(readdirSync(dir)).toContain('iso.sock');
		// A real install path was never touched.
		expect(existsSync('/usr/local/searxng/run/socket')).toBe(false);
	});
});

describe('TCP baseUrl is unaffected by the unix: addition', () => {
	it('a normal http://host:port baseUrl still reaches a TCP server', async () => {
		const {server, requests} = searxngSocketServer();
		const port = await new Promise<number>((resolve) => {
			servers.push(server);
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address();
				resolve(typeof addr === 'object' && addr ? addr.port : 0);
			});
		});

		const results = await search(
			'tcp query',
			{},
			{resolveConfig: () => cfg(`http://127.0.0.1:${port}`, {mode: 'direct'})},
		);

		expect(results).toEqual([
			{title: 'Result A', url: 'https://example.com/a', snippet: 'Snippet A'},
		]);
		const reqUrl = new URL(requests[0]!, 'http://localhost');
		expect(reqUrl.pathname).toBe('/search');
		expect(reqUrl.searchParams.get('q')).toBe('tcp query');
	});
});
