import {afterEach, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {AddressInfo} from 'node:net';
import {createHttp} from '../src/core/http.js';

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
	servers.push(server);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () =>
			resolve((server.address() as AddressInfo).port),
		);
	});
}

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
	);
});

describe('createHttp (direct dispatcher)', () => {
	it('fetchJson parses a JSON body', async () => {
		const server = createServer((_req, res) => {
			res.writeHead(200, {'content-type': 'application/json'});
			res.end(JSON.stringify({hello: 'world'}));
		});
		const port = await listen(server);

		const http = createHttp(undefined);
		const body = await http.fetchJson<{hello: string}>(
			`http://127.0.0.1:${port}/j`,
		);
		expect(body).toEqual({hello: 'world'});
	});

	it('fetchText returns the body text', async () => {
		const server = createServer((_req, res) => {
			res.writeHead(200, {'content-type': 'text/plain'});
			res.end('plain');
		});
		const port = await listen(server);

		const http = createHttp(undefined);
		expect(await http.fetchText(`http://127.0.0.1:${port}/t`)).toBe('plain');
	});

	it('throws on a non-2xx response', async () => {
		const server = createServer((_req, res) => {
			res.writeHead(503);
			res.end('down');
		});
		const port = await listen(server);

		const http = createHttp(undefined);
		await expect(http.fetchText(`http://127.0.0.1:${port}/x`)).rejects.toThrow(
			/503/,
		);
	});

	it('aborts when the per-request timeout elapses', async () => {
		const server = createServer(() => {
			// never respond → force the timeout to fire
		});
		const port = await listen(server);

		const http = createHttp(undefined);
		await expect(
			http.fetchText(`http://127.0.0.1:${port}/slow`, {timeoutMs: 50}),
		).rejects.toThrow();
	});
});
