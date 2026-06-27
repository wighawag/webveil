import {afterEach, describe, expect, it} from 'vitest';
import {createServer, type Server} from 'node:http';
import {AddressInfo, connect as netConnect} from 'node:net';
import {Agent, ProxyAgent} from 'undici';
import {
	assertEgressAllowsBaseUrl,
	buildDispatcher,
	createEgressFetch,
	EgressError,
	fetchEgressConfig,
} from '../src/core/egress.js';
import type {Config, Egress} from '../src/core/config.js';

function cfg(egress: Config['egress']): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress,
		fetchSize: 'm',
	};
}

function full(overrides: Partial<Config> = {}): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress: {mode: 'direct'},
		fetchSize: 'm',
		...overrides,
	};
}

const SOCKS: Egress = {mode: 'socks5', url: 'socks5://127.0.0.1:9050'};

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

describe('assertEgressAllowsBaseUrl (backend-hop false-confidence guard)', () => {
	it('ALLOWS direct egress on a loopback baseUrl (the normal local case)', () => {
		expect(() =>
			assertEgressAllowsBaseUrl(full({egress: {mode: 'direct'}})),
		).not.toThrow();
	});

	it('THROWS on a non-direct egress with a loopback-TCP baseUrl', () => {
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({baseUrl: 'http://127.0.0.1:8080', egress: SOCKS}),
			),
		).toThrow(EgressError);
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({baseUrl: 'http://localhost:8080', egress: SOCKS}),
			),
		).toThrow(EgressError);
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({baseUrl: 'http://[::1]:8080', egress: SOCKS}),
			),
		).toThrow(EgressError);
	});

	it('THROWS on a non-direct egress with a unix: socket baseUrl', () => {
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({baseUrl: 'unix:/run/searxng.sock', egress: SOCKS}),
			),
		).toThrow(EgressError);
	});

	it('ALLOWS a non-direct egress on a REMOTE baseUrl (remote SearXNG over SOCKS)', () => {
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({baseUrl: 'https://searx.example.com', egress: SOCKS}),
			),
		).not.toThrow();
	});

	it('does NOT treat a LAN RFC1918 backend as loopback (allowed over SOCKS)', () => {
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({baseUrl: 'http://192.168.1.5:8080', egress: SOCKS}),
			),
		).not.toThrow();
	});

	it('keys on the BACKEND hop only: a local+direct backend with a socks5 fetch hop is ALLOWED', () => {
		// The blessed local-SearXNG + proxied-web_fetch topology (docs/adr/0003):
		// the guard inspects egress (direct) + baseUrl, NOT fetchEgress.
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({
					baseUrl: 'http://127.0.0.1:8080',
					egress: {mode: 'direct'},
					fetchEgress: SOCKS,
				}),
			),
		).not.toThrow();
		expect(() =>
			assertEgressAllowsBaseUrl(
				full({
					baseUrl: 'unix:/run/searxng.sock',
					egress: {mode: 'direct'},
					fetchEgress: SOCKS,
				}),
			),
		).not.toThrow();
	});
});

describe('fetchEgressConfig (resolves the FETCH-hop egress)', () => {
	it('inherits egress when fetchEgress is unset (single-knob, unchanged)', () => {
		const c = full({egress: SOCKS});
		expect(fetchEgressConfig(c)).toBe(c); // same object: no fetch-hop override
		expect(fetchEgressConfig(c).egress).toEqual(SOCKS);
	});

	it('uses fetchEgress for the fetch hop, leaving the backend egress alone', () => {
		const c = full({egress: {mode: 'direct'}, fetchEgress: SOCKS});
		const fc = fetchEgressConfig(c);
		expect(fc.egress).toEqual(SOCKS); // fetch hop is proxied
		expect(c.egress).toEqual({mode: 'direct'}); // backend hop untouched
		expect(fc.baseUrl).toBe(c.baseUrl); // carried (irrelevant to fetch targets)
	});

	it('a fetch hop built from fetchEgressConfig routes through the socks dispatcher', async () => {
		const c = full({
			baseUrl: 'unix:/run/searxng.sock',
			egress: {mode: 'direct'},
			fetchEgress: SOCKS,
		});
		const d = buildDispatcher(fetchEgressConfig(c));
		expect(d).toBeInstanceOf(Agent); // fetch-socks Agent over a socks connector
		await d?.close();
		// And the backend hop stays direct (undefined dispatcher).
		expect(buildDispatcher(c)).toBeUndefined();
	});

	it('FAILS LOUD when the fetch-hop proxy is unbuildable (never silent direct)', () => {
		const c = full({
			egress: {mode: 'direct'},
			fetchEgress: {mode: 'socks5', url: 'not a url'},
		});
		expect(() => createEgressFetch(fetchEgressConfig(c))).toThrow(EgressError);
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
