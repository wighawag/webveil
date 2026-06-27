import {describe, expect, it, vi} from 'vitest';
import {fetch, fetchAll, type FetchDeps} from '../src/core/fetch.js';
import type {Config} from '../src/core/config.js';
import type {EgressFetch} from '../src/core/egress.js';
import type {Backend, FetchResult} from '../src/core/backends/types.js';

function cfg(overrides: Partial<Config> = {}): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress: {mode: 'direct'},
		fetchSize: 'm',
		...overrides,
	};
}

/** A backend WITHOUT `/extract`: forces the default distilly Extractor path. */
function searchOnlyBackend(): Backend {
	return {
		async search() {
			return [];
		},
	};
}

/** A unique, identifiable non-global fetch (proves the guarded egress fetch). */
function spyEgressFetch(): EgressFetch {
	return vi.fn(async () =>
		Promise.reject(new Error('fetch test: egress fetch must not run')),
	) as unknown as EgressFetch;
}

/** Base deps wiring the default (distilly) path, with the network seamed out. */
function distillyDeps(
	overrides: Partial<FetchDeps> = {},
	config = cfg(),
): {deps: FetchDeps; extract: ReturnType<typeof vi.fn>} {
	const extract = vi.fn(
		async (url: string): Promise<FetchResult> => ({
			url,
			markdown: `# ${url}`,
			truncated: false,
		}),
	);
	const deps: FetchDeps = {
		resolveConfig: () => config,
		getBackend: () => searchOnlyBackend(),
		createEgressFetch: () => spyEgressFetch(),
		guardEgressFetch: (f) => f,
		extract: extract as never,
		...overrides,
	};
	return {deps, extract};
}

describe('core.fetch()', () => {
	it('returns { markdown, truncated, url } via the distilly Extractor by default', async () => {
		const {deps: d} = distillyDeps();
		const result = await fetch('https://example.com/p', {}, d);
		expect(result).toEqual({
			url: 'https://example.com/p',
			markdown: '# https://example.com/p',
			truncated: false,
		});
	});

	it('surfaces distilly truncated through unchanged', async () => {
		const {deps: d} = distillyDeps({
			extract: (async (url: string) => ({
				url,
				markdown: 'clipped',
				truncated: true,
			})) as never,
		});
		const result = await fetch('https://example.com', {}, d);
		expect(result.truncated).toBe(true);
	});

	it('forwards the per-call size to the Extractor', async () => {
		const {deps: d, extract} = distillyDeps();
		await fetch('https://example.com', {size: 'l'}, d);
		expect(extract).toHaveBeenCalledTimes(1);
		const [, , options] = extract.mock.calls[0]!;
		expect((options as {size: string}).size).toBe('l');
	});
});

describe('extractor-vs-/extract branch', () => {
	it('uses a backend /extract when the configured backend provides one (OVERRIDES distilly)', async () => {
		const backendResult: FetchResult = {
			url: 'https://example.com',
			title: 'B',
			markdown: 'from backend',
			truncated: false,
		};
		const backendFetch = vi.fn(async () => backendResult);
		const extract = vi.fn();
		const backend: Backend = {
			async search() {
				return [];
			},
			fetch: backendFetch,
		};
		const http = {
			fetchJson: async () => ({}),
			fetchText: async () => '',
		};
		const result = await fetch(
			'https://example.com',
			{size: 's'},
			{
				resolveConfig: () => cfg({backend: 'tavily-compat'}),
				getBackend: () => backend,
				buildDispatcher: () => undefined,
				createHttp: () => http,
				extract: extract as never,
			},
		);
		expect(result).toEqual(backendResult);
		// distilly was NOT used: the backend /extract overrode it.
		expect(extract).not.toHaveBeenCalled();
		expect(backendFetch).toHaveBeenCalledTimes(1);
		const [calledUrl, calledHttp, calledOptions] = backendFetch.mock.calls[0]!;
		expect(calledUrl).toBe('https://example.com');
		// The backend is handed the proxied http helper, never a global fetch.
		expect(calledHttp).toBe(http);
		expect((calledOptions as {size: string}).size).toBe('s');
	});

	it('falls back to the distilly Extractor when the backend has no /extract', async () => {
		const {deps: d, extract} = distillyDeps();
		await fetch('https://example.com', {}, d);
		expect(extract).toHaveBeenCalledTimes(1);
	});
});

describe('list-ready internal (story 12)', () => {
	it('fetchAll processes a LIST, preserving order', async () => {
		const {deps: d} = distillyDeps();
		const out = await fetchAll(
			['https://a.test/', 'https://b.test/', 'https://c.test/'],
			{},
			d,
		);
		expect(out.map((r) => r.url)).toEqual([
			'https://a.test/',
			'https://b.test/',
			'https://c.test/',
		]);
	});

	it('the single-URL fetch() is a thin wrapper over fetchAll (one result)', async () => {
		const {deps: d, extract} = distillyDeps();
		const result = await fetch('https://only.test/', {}, d);
		expect(extract).toHaveBeenCalledTimes(1);
		expect(result.url).toBe('https://only.test/');
	});

	it('fetchAll([]) returns an empty list (no extractor calls)', async () => {
		const {deps: d, extract} = distillyDeps();
		const out = await fetchAll([], {}, d);
		expect(out).toEqual([]);
		expect(extract).not.toHaveBeenCalled();
	});
});

describe('distilly is handed webveil egress fetch (never a global), guarded by SSRF', () => {
	it('injects the GUARDED egress fetch into the Extractor (not the global fetch)', async () => {
		const egressFetch = spyEgressFetch();
		const guardedFetch = spyEgressFetch();
		const guardEgressFetch = vi.fn(() => guardedFetch);
		const extract = vi.fn(async (url: string) => ({
			url,
			markdown: '',
			truncated: false,
		}));
		// Capture the createEgressFetch the Extractor was handed.
		const capturedExtract = vi.fn(
			async (
				url: string,
				_config: Config,
				_options: unknown,
				deps: {createEgressFetch?: (c: Config) => EgressFetch},
			) => {
				const injected = deps.createEgressFetch!(cfg());
				expect(injected).toBe(guardedFetch);
				expect(injected).not.toBe(globalThis.fetch);
				return extract(url);
			},
		);
		await fetch(
			'https://example.com',
			{},
			{
				resolveConfig: () => cfg(),
				getBackend: () => searchOnlyBackend(),
				createEgressFetch: () => egressFetch,
				guardEgressFetch,
				extract: capturedExtract as never,
			},
		);
		// The guard wrapped the egress fetch (the result is what distilly gets).
		expect(guardEgressFetch).toHaveBeenCalledTimes(1);
		expect(guardEgressFetch).toHaveBeenCalledWith(egressFetch, cfg());
	});
});

describe('per-hop egress: web_fetch uses the FETCH hop (fetchEgress ?? egress)', () => {
	it('builds the egress fetch + guard from the FETCH-hop config (fetchEgress)', async () => {
		// Local backend on a DIRECT backend hop, web_fetch proxied via socks5.
		const config = cfg({
			baseUrl: 'unix:/run/searxng.sock',
			egress: {mode: 'direct'},
			fetchEgress: {mode: 'socks5', url: 'socks5h://127.0.0.1:1080'},
		});
		const createEgressFetch = vi.fn(() => spyEgressFetch());
		const guardEgressFetch = vi.fn((f: EgressFetch) => f);
		const extract = vi.fn(async (url: string) => ({
			url,
			markdown: '',
			truncated: false,
		}));
		await fetch(
			'https://example.com/p',
			{},
			{
				resolveConfig: () => config,
				getBackend: () => searchOnlyBackend(),
				createEgressFetch,
				guardEgressFetch,
				extract: extract as never,
			},
		);
		// Both the egress fetch AND the SSRF guard see the FETCH-hop egress (socks5),
		// NOT the backend-hop egress (direct). The carried baseUrl is the backend's
		// (irrelevant to fetch targets) but the egress is the fetch hop's.
		const egressArg = createEgressFetch.mock.calls[0]![0] as Config;
		expect(egressArg.egress).toEqual({
			mode: 'socks5',
			url: 'socks5h://127.0.0.1:1080',
		});
		const guardCfg = guardEgressFetch.mock.calls[0]![1] as Config;
		expect(guardCfg.egress).toEqual({
			mode: 'socks5',
			url: 'socks5h://127.0.0.1:1080',
		});
	});

	it('inherits the backend egress for the fetch hop when fetchEgress is unset', async () => {
		const config = cfg({
			baseUrl: 'https://searx.example.com',
			egress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'},
		});
		const createEgressFetch = vi.fn(() => spyEgressFetch());
		await fetch(
			'https://example.com',
			{},
			{
				resolveConfig: () => config,
				getBackend: () => searchOnlyBackend(),
				createEgressFetch,
				guardEgressFetch: (f) => f,
				extract: (async (url: string) => ({
					url,
					markdown: '',
					truncated: false,
				})) as never,
			},
		);
		const egressArg = createEgressFetch.mock.calls[0]![0] as Config;
		expect(egressArg.egress).toEqual(config.egress); // inherited
	});

	it('FAILS LOUD (no I/O) when the fetch-hop proxy is unbuildable', async () => {
		// Real createEgressFetch (default) + an unbuildable fetchEgress proxy: the
		// throw happens at build time, before the extractor is reached.
		const extract = vi.fn();
		await expect(
			fetch(
				'https://example.com',
				{},
				{
					resolveConfig: () =>
						cfg({
							baseUrl: 'http://127.0.0.1:8080',
							egress: {mode: 'direct'},
							fetchEgress: {mode: 'socks5', url: 'not a url'},
						}),
					getBackend: () => searchOnlyBackend(),
					extract: extract as never,
				},
			),
		).rejects.toThrow(/could not build proxy/);
		expect(extract).not.toHaveBeenCalled();
	});

	it('a backend /extract uses the BACKEND hop, not the fetch hop', async () => {
		// A backend with its own /extract reaches the backend baseUrl, so it must use
		// the BACKEND dispatcher (built from config.egress), never fetchEgress.
		const config = cfg({
			backend: 'tavily-compat',
			baseUrl: 'https://tavily.example.com',
			egress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'},
			fetchEgress: {mode: 'direct'},
		});
		const dispatcher = {} as never;
		const buildDispatcher = vi.fn(() => dispatcher);
		const http = {fetchJson: async () => ({}), fetchText: async () => ''};
		const backendFetch = vi.fn(async (url: string) => ({
			url,
			markdown: 'b',
			truncated: false,
		}));
		const backend: Backend = {
			async search() {
				return [];
			},
			fetch: backendFetch,
		};
		await fetch(
			'https://example.com',
			{},
			{
				resolveConfig: () => config,
				getBackend: () => backend,
				buildDispatcher,
				createHttp: () => http,
			},
		);
		// The backend-hop dispatcher was built from the FULL config (backend egress).
		expect(buildDispatcher).toHaveBeenCalledWith(config);
	});
});

describe('SSRF via the egress-bound fetch (real guard, end-to-end)', () => {
	// Use the REAL extract + REAL guard so the guarded egress fetch is actually
	// exercised against a private-IP request, covering distilly's rule-rewritten
	// requests (not just direct GETs). The `extract` override here delegates to
	// the REAL extract, threading core's guarded fetch (deps.createEgressFetch)
	// through, and only stubs distilly's `urlToMarkdown` so it CALLS that injected
	// fetch as distilly would.
	async function realExtractDep() {
		const {extract: realExtract} = await import('../src/core/extract.js');
		return (
			url: string,
			config: Config,
			options: unknown,
			coreDeps: {createEgressFetch?: (c: Config) => EgressFetch},
		) =>
			realExtract(url, config, options as never, {
				// thread core's guarded fetch through to distilly:
				createEgressFetch: coreDeps.createEgressFetch,
				urlToMarkdown: (async (
					target: string | URL,
					opts: {fetch: EgressFetch},
				) => {
					// distilly performs its network I/O through the injected fetch:
					await opts.fetch(target);
					return {markdown: 'ok', truncated: false};
				}) as never,
			});
	}

	it('BLOCKS a private-IP URL on direct egress (covers distilly requests)', async () => {
		const extractDep = await realExtractDep();
		await expect(
			fetch(
				'http://127.0.0.1/secret',
				{},
				{
					resolveConfig: () => cfg({egress: {mode: 'direct'}}),
					getBackend: () => searchOnlyBackend(),
					// real createEgressFetch + real guardEgressFetch (defaults),
					// but stub the transport so a public host would not do real I/O:
					createEgressFetch: () =>
						(async () => new Response('ok')) as unknown as EgressFetch,
					extract: extractDep as never,
				},
			),
		).rejects.toThrow(/SSRF/);
	});

	it('ALLOWS the SAME private-IP URL under proxy egress (Tor/Mullvad)', async () => {
		const extractDep = await realExtractDep();
		const result = await fetch(
			'http://10.64.0.1/x',
			{},
			{
				resolveConfig: () =>
					cfg({egress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'}}),
				getBackend: () => searchOnlyBackend(),
				// Real guard, but a stub egress fetch so no real socks I/O happens.
				createEgressFetch: () =>
					(async () => new Response('ok')) as unknown as EgressFetch,
				extract: extractDep as never,
			},
		);
		expect(result.truncated).toBe(false);
	});
});
