// The plain `web_fetch` path's SSRF guard on REDIRECT hops (task
// plain-fetch-ssrf-check-every-redirect). A separate file because it spies on
// `node:dns/promises` (a pass-through mock, so real lookups still happen) to
// prove that proxy egress does no local DNS.

import {createServer, type Server} from 'node:http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fetch as undiciFetch} from 'undici';

vi.mock('node:dns/promises', async (importOriginal) => {
	const real = await importOriginal<typeof import('node:dns/promises')>();
	return {...real, lookup: vi.fn(real.lookup)};
});

import {lookup} from 'node:dns/promises';
import {guardEgressFetch, SsrfError} from '../src/core/security.js';
import {createEgressFetch} from '../src/core/egress.js';
import {fetch as coreFetch} from '../src/core/fetch.js';
import type {Config} from '../src/core/config.js';
import type {EgressFetch} from '../src/core/egress.js';
import type {Backend} from '../src/core/backends/types.js';

const PUBLIC = 'https://1.1.1.1/start'; // a literal public IP: no DNS lookup

function cfg(egress: Config['egress'] = {mode: 'direct'}): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress,
		fetchSize: 'm',
	};
}

/** A local server recording every path it is asked for. */
let server: Server;
let port: number;
let hits: string[];

beforeEach(async () => {
	hits = [];
	server = createServer((req, res) => {
		hits.push(req.url ?? '');
		if (req.url === '/a') {
			res.writeHead(302, {location: '/b'}); // relative
			res.end();
		} else if (req.url === '/b') {
			// absolute, across hosts (127.0.0.1 -> localhost)
			res.writeHead(301, {location: `http://localhost:${port}/c`});
			res.end();
		} else {
			res.writeHead(200, {'content-type': 'text/html'});
			res.end(
				'<html><body><h1>Arrived</h1><p>See <a href="next">next</a>.</p></body></html>',
			);
		}
	});
	port = await new Promise<number>((resolve) =>
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			resolve(typeof addr === 'object' && addr ? addr.port : 0);
		}),
	);
	vi.mocked(lookup).mockClear();
});

afterEach(async () => {
	await new Promise((resolve) => server.close(resolve));
});

/**
 * An inner fetch that answers the public start url with a redirect to `to`
 * and sends every other request for real (undici), so a request that slips
 * past the guard reaches the local server and is recorded in `hits`.
 */
function redirectingFetch(to: string, status = 302) {
	const calls: {url: string; init?: RequestInit}[] = [];
	const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : String(input);
		calls.push({url, init});
		if (url === PUBLIC)
			return new Response(null, {status, headers: {location: to}});
		return undiciFetch(url, init as never);
	}) as unknown as EgressFetch;
	return {inner, calls};
}

describe('guardEgressFetch on direct egress: every redirect hop is SSRF-checked', () => {
	it('refuses a redirect to 127.0.0.1 before the target is requested', async () => {
		const {inner, calls} = redirectingFetch(`http://127.0.0.1:${port}/`);
		const guarded = guardEgressFetch(inner, cfg());
		await expect(guarded(PUBLIC, {redirect: 'follow'})).rejects.toBeInstanceOf(
			SsrfError,
		);
		expect(hits).toEqual([]);
		expect(calls.map((c) => c.url)).toEqual([PUBLIC]);
		expect(calls[0]!.init?.redirect).toBe('manual');
	});

	it('refuses a redirect to a hostname resolving to a private address', async () => {
		const {inner} = redirectingFetch(`http://localhost:${port}/`);
		const guarded = guardEgressFetch(inner, cfg());
		await expect(guarded(PUBLIC, {redirect: 'follow'})).rejects.toBeInstanceOf(
			SsrfError,
		);
		expect(hits).toEqual([]);
	});

	it('refuses a redirect to cloud metadata', async () => {
		const {inner, calls} = redirectingFetch(
			'http://169.254.169.254/latest/meta-data',
			307,
		);
		const guarded = guardEgressFetch(inner, cfg());
		await expect(guarded(PUBLIC)).rejects.toBeInstanceOf(SsrfError);
		expect(calls).toHaveLength(1);
	});

	it('refuses a redirect to a non-http(s) url', async () => {
		const {inner, calls} = redirectingFetch('file:///etc/passwd');
		const guarded = guardEgressFetch(inner, cfg());
		await expect(guarded(PUBLIC)).rejects.toThrow(/non-http\(s\)/);
		expect(calls).toHaveLength(1);
	});

	it('stops after 20 redirects', async () => {
		const {inner, calls} = redirectingFetch(PUBLIC, 308);
		const guarded = guardEgressFetch(inner, cfg());
		await expect(guarded(PUBLIC)).rejects.toThrow(/too many redirects/);
		expect(calls).toHaveLength(21);
	});

	it("honours redirect: 'manual' (returns the redirect) and 'error' (rejects)", async () => {
		const {inner, calls} = redirectingFetch(`http://127.0.0.1:${port}/`);
		const guarded = guardEgressFetch(inner, cfg());
		const response = await guarded(PUBLIC, {redirect: 'manual'});
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe(`http://127.0.0.1:${port}/`);
		await expect(guarded(PUBLIC, {redirect: 'error'})).rejects.toBeInstanceOf(
			TypeError,
		);
		expect(calls).toHaveLength(2);
		expect(hits).toEqual([]);
	});

	it('turns a POST into a body-less GET on 303, keeps the method on 307', async () => {
		const seen: {method?: string; body?: unknown}[] = [];
		const make = (status: number) =>
			(async (input: RequestInfo | URL, init?: RequestInit) => {
				seen.push({method: init?.method, body: init?.body});
				return String(input) === PUBLIC
					? new Response(null, {status, headers: {location: '/next'}})
					: new Response('ok');
			}) as unknown as EgressFetch;
		const post = {method: 'POST', body: 'x', redirect: 'follow'} as const;
		await guardEgressFetch(make(303), cfg())(PUBLIC, post);
		expect(seen[1]).toEqual({method: 'GET', body: null});
		seen.length = 0;
		await guardEgressFetch(make(307), cfg())(PUBLIC, post);
		expect(seen[1]).toEqual({method: 'POST', body: 'x'});
	});

	it('follows a legitimate chain (relative, absolute, across hosts) and reports the last hop', async () => {
		const checked: string[] = [];
		const guarded = guardEgressFetch(
			createEgressFetch(cfg()), // real undici
			cfg(),
			{
				// the local server is private, so allow it but record every hop:
				assertPublicUrl: async (url) => void checked.push(url),
			},
		);
		const start = `http://127.0.0.1:${port}/a`;
		const final = `http://localhost:${port}/c`;
		const response = await guarded(start, {redirect: 'follow'});
		expect(response.status).toBe(200);
		expect(response.url).toBe(final);
		expect(response.redirected).toBe(true);
		expect(await response.text()).toContain('Arrived');
		expect(checked).toEqual([start, `http://127.0.0.1:${port}/b`, final]);
		// Same final url as undici following natively:
		const native = await undiciFetch(start, {redirect: 'follow'});
		expect(native.url).toBe(response.url);
		await native.text();
	});

	it('leaves web_fetch output for a redirect chain unchanged (real distilly)', async () => {
		const searchOnly: Backend = {
			async search() {
				return [];
			},
		};
		const url = `http://127.0.0.1:${port}/a`;
		const run = (guard: (f: EgressFetch, c: Config) => EgressFetch) =>
			coreFetch(
				url,
				{},
				{
					resolveConfig: () => cfg(),
					getBackend: () => searchOnly,
					guardEgressFetch: guard,
				},
			);
		const guarded = await run((f, c) =>
			guardEgressFetch(f, c, {assertPublicUrl: async () => {}}),
		);
		const native = await run((f) => f); // undici follows natively (before)
		expect(guarded).toEqual(native);
		expect(guarded.markdown).toContain('Arrived');
	});
});

describe('guardEgressFetch under proxy egress: unchanged, no local DNS', () => {
	for (const egress of [
		{mode: 'http', url: 'http://127.0.0.1:8118'},
		{mode: 'socks5', url: 'socks5://127.0.0.1:9050'},
	] as Config['egress'][])
		it(`${egress.mode}: delegates the request as is and resolves nothing locally`, async () => {
			const inner = vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: {location: 'http://localhost/admin'},
					}),
			) as unknown as EgressFetch;
			const guarded = guardEgressFetch(inner, cfg(egress));
			const init = {redirect: 'follow'} as const;
			const response = await guarded('http://localhost/start', init);
			// the egress fetch (undici) owns redirects: the response is its own
			expect(response.status).toBe(302);
			expect(inner).toHaveBeenCalledTimes(1);
			expect(inner).toHaveBeenCalledWith('http://localhost/start', init);
			expect(lookup).not.toHaveBeenCalled();
		});

	it('the direct-egress control does resolve locally (the spy is live)', async () => {
		const {inner} = redirectingFetch(`http://localhost:${port}/`);
		await expect(guardEgressFetch(inner, cfg())(PUBLIC)).rejects.toThrow(
			SsrfError,
		);
		expect(lookup).toHaveBeenCalled();
	});
});
