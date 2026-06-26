import {afterEach, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {AddressInfo, connect as netConnect} from 'node:net';
import {Agent, ProxyAgent} from 'undici';
import {
	buildDispatcher,
	createEgressFetch,
	EgressError,
} from '../src/core/egress.js';
import type {Config} from '../src/core/config.js';

function cfg(egress: Config['egress']): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress,
		fetchSize: 'm',
	};
}

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
	servers.push(server);
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			resolve((server.address() as AddressInfo).port);
		});
	});
}

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
	);
});

describe('buildDispatcher', () => {
	it('returns undefined for direct egress', () => {
		expect(buildDispatcher(cfg({mode: 'direct'}))).toBeUndefined();
	});

	it('returns a ProxyAgent for http egress', async () => {
		const d = buildDispatcher(
			cfg({mode: 'http', url: 'http://127.0.0.1:8118'}),
		);
		expect(d).toBeInstanceOf(ProxyAgent);
		await d?.close();
	});

	it('returns a socks dispatcher for socks5 egress', async () => {
		const d = buildDispatcher(
			cfg({mode: 'socks5', url: 'socks5://127.0.0.1:9050'}),
		);
		expect(d).toBeDefined();
		// fetch-socks produces an undici Agent over a socks connector.
		expect(d).toBeInstanceOf(Agent);
		expect(typeof d?.dispatch).toBe('function');
		await d?.close();
	});

	it('FAILS LOUD on an unbuildable socks5 proxy (never returns direct)', () => {
		let threw: unknown;
		try {
			buildDispatcher(cfg({mode: 'socks5', url: 'not a url'}));
		} catch (e) {
			threw = e;
		}
		expect(threw).toBeInstanceOf(EgressError);
	});

	it('FAILS LOUD on a missing socks5 proxy url', () => {
		expect(() => buildDispatcher(cfg({mode: 'socks5', url: ''}))).toThrow(
			EgressError,
		);
	});

	it('FAILS LOUD on a non-socks url for socks5 mode', () => {
		expect(() =>
			buildDispatcher(cfg({mode: 'socks5', url: 'http://127.0.0.1:9050'})),
		).toThrow(EgressError);
	});

	it('FAILS LOUD on a missing http proxy url', () => {
		expect(() => buildDispatcher(cfg({mode: 'http', url: ''}))).toThrow(
			EgressError,
		);
	});
});

describe('createEgressFetch', () => {
	it('performs requests (direct mode reaches the target)', async () => {
		let hits = 0;
		const server = createServer((_req, res) => {
			hits++;
			res.writeHead(200, {'content-type': 'text/plain'});
			res.end('ok');
		});
		const port = await listen(server);

		const f = createEgressFetch(cfg({mode: 'direct'}));
		const res = await f(`http://127.0.0.1:${port}/probe`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('ok');
		expect(hits).toBe(1);
	});

	it('routes requests THROUGH the dispatcher (http proxy sees the request)', async () => {
		// Target server the proxy tunnels to.
		const target = createServer((_req, res) => {
			res.writeHead(200, {'content-type': 'text/plain'});
			res.end('via-proxy');
		});
		const targetPort = await listen(target);

		// A minimal CONNECT proxy that records every tunnel it is asked for.
		const connects: string[] = [];
		const proxy = createServer((_req, res) => {
			res.writeHead(405);
			res.end();
		});
		proxy.on('connect', (req, clientSocket, head) => {
			connects.push(req.url ?? '');
			const [host, port] = (req.url ?? '').split(':');
			const upstream = netConnect(Number(port), host, () => {
				clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
				upstream.write(head);
				upstream.pipe(clientSocket);
				clientSocket.pipe(upstream);
			});
			upstream.on('error', () => clientSocket.end());
		});
		const proxyPort = await listen(proxy);

		const f = createEgressFetch(
			cfg({mode: 'http', url: `http://127.0.0.1:${proxyPort}`}),
		);
		const res = await f(`http://127.0.0.1:${targetPort}/page`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('via-proxy');
		// The request was tunnelled through the proxy, not sent direct.
		expect(connects).toContain(`127.0.0.1:${targetPort}`);
	});

	it('THROWS on an unbuildable proxy rather than fetching un-proxied', () => {
		// The throw happens at construction (before any I/O): no un-proxied fetch.
		expect(() =>
			createEgressFetch(cfg({mode: 'socks5', url: 'not a url'})),
		).toThrow(EgressError);
	});
});
