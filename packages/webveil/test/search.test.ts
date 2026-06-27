import {afterEach, describe, expect, it, vi} from 'vitest';
import {search, type SearchDeps} from '../src/core/search.js';
import type {Config} from '../src/core/config.js';
import type {
	Http,
	HttpRequestOptions,
	SearchOptions,
	SearchResult,
} from '../src/core/backends/types.js';

function cfg(overrides: Partial<Config> = {}): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress: {mode: 'direct'},
		fetchSize: 'm',
		...overrides,
	};
}

/**
 * A FAKE `http` helper: records calls, never touches the network. Whatever the
 * core builds and hands the backend, it must be exactly THIS object (so the
 * backend cannot reach a global fetch / bypass egress).
 */
function fakeHttp(): Http {
	return {
		async fetchJson<T>(): Promise<T> {
			throw new Error('fake http: fetchJson must not be called in this test');
		},
		async fetchText(): Promise<string> {
			throw new Error('fake http: fetchText must not be called in this test');
		},
	};
}

/** A fake backend returning a fixed result set, recording how it was called. */
function fakeBackend(results: SearchResult[]) {
	const calls: {query: string; http: Http; options?: SearchOptions}[] = [];
	const backend = {
		async search(
			query: string,
			http: Http,
			options?: SearchOptions,
		): Promise<SearchResult[]> {
			calls.push({query, http, options});
			return results;
		},
	};
	return {backend, calls};
}

/** Build SearchDeps wiring the fakes, with sensible config defaults. */
function deps(
	results: SearchResult[],
	overrides: Partial<SearchDeps> = {},
): {
	deps: SearchDeps;
	http: Http;
	calls: ReturnType<typeof fakeBackend>['calls'];
} {
	const http = fakeHttp();
	const {backend, calls} = fakeBackend(results);
	const d: SearchDeps = {
		resolveConfig: () => cfg(),
		buildDispatcher: () => undefined,
		createHttp: () => http,
		getBackend: () => backend,
		...overrides,
	};
	return {deps: d, http, calls};
}

describe('core.search()', () => {
	it('returns the normalized SearchResult[] from the selected backend', async () => {
		const results: SearchResult[] = [
			{title: 'A', url: 'https://example.com/a', snippet: 'sa'},
			{title: 'B', url: 'https://example.com/b'},
		];
		const {deps: d} = deps(results);
		expect(await search('q', {}, d)).toEqual(results);
	});

	it('dedups duplicate hits by url, preserving first-seen order', async () => {
		const {deps: d} = deps([
			{title: 'A', url: 'https://example.com/a', snippet: 'first'},
			{title: 'B', url: 'https://example.com/b'},
			{title: 'A (dup)', url: 'https://example.com/a', snippet: 'second'},
			{title: 'C', url: 'https://example.com/c'},
		]);
		expect(await search('q', {}, d)).toEqual([
			{title: 'A', url: 'https://example.com/a', snippet: 'first'},
			{title: 'B', url: 'https://example.com/b'},
			{title: 'C', url: 'https://example.com/c'},
		]);
	});

	it('clamps to maxResults AFTER dedup (caller gets unique hits)', async () => {
		const {deps: d} = deps([
			{title: 'A', url: 'https://example.com/a'},
			{title: 'A dup', url: 'https://example.com/a'},
			{title: 'B', url: 'https://example.com/b'},
			{title: 'C', url: 'https://example.com/c'},
		]);
		const out = await search('q', {maxResults: 2}, d);
		// Without dedup-before-clamp, a leading duplicate would eat a slot and
		// leave only 1 unique result; we assert 2 UNIQUE hits.
		expect(out).toEqual([
			{title: 'A', url: 'https://example.com/a'},
			{title: 'B', url: 'https://example.com/b'},
		]);
	});

	it('applies a default clamp when maxResults is omitted', async () => {
		const many: SearchResult[] = Array.from({length: 25}, (_v, i) => ({
			title: `R${i}`,
			url: `https://example.com/${i}`,
		}));
		const out = await search('q', {}, deps(many).deps);
		expect(out).toHaveLength(10);
		expect(out[0]).toEqual({title: 'R0', url: 'https://example.com/0'});
		expect(out[9]).toEqual({title: 'R9', url: 'https://example.com/9'});
	});

	it('hands the backend ONLY the proxied http helper (no global fetch)', async () => {
		const {
			deps: d,
			http,
			calls,
		} = deps([{title: 'A', url: 'https://example.com/a'}]);
		await search('webveil', {}, d);
		expect(calls).toHaveLength(1);
		// The EXACT helper built from the dispatcher is what the backend receives.
		expect(calls[0]!.http).toBe(http);
		expect(calls[0]!.query).toBe('webveil');
	});

	it('does NOT pre-clamp at the backend (dedup happens over the full set)', async () => {
		const {deps: d, calls} = deps([{title: 'A', url: 'https://example.com/a'}]);
		await search('q', {maxResults: 3}, d);
		// maxResults is owned by the core; the backend is not asked to clamp.
		expect(calls[0]!.options?.maxResults).toBeUndefined();
	});

	it('forwards the abort signal to the backend', async () => {
		const {deps: d, calls} = deps([{title: 'A', url: 'https://example.com/a'}]);
		const controller = new AbortController();
		await search('q', {signal: controller.signal}, d);
		expect(calls[0]!.options?.signal).toBe(controller.signal);
	});

	it('builds the http helper from the dispatcher built from the resolved config', async () => {
		// A REMOTE baseUrl: a non-direct egress on a LOCAL baseUrl is the
		// false-confidence combo the backend-hop guard now rejects (see the
		// per-hop egress tests), so this wiring assertion keys on a remote backend.
		const config = cfg({
			baseUrl: 'https://searx.example.com',
			egress: {mode: 'http', url: 'http://127.0.0.1:8118'},
		});
		const dispatcher = {} as never;
		const buildDispatcher = vi.fn(() => dispatcher);
		const createHttp = vi.fn(() => fakeHttp());
		const {backend} = fakeBackend([]);
		await search(
			'q',
			{},
			{
				resolveConfig: () => config,
				buildDispatcher,
				createHttp,
				getBackend: () => backend,
			},
		);
		expect(buildDispatcher).toHaveBeenCalledWith(config);
		expect(createHttp).toHaveBeenCalledWith(dispatcher);
	});

	it('selects the backend by config.backend name', async () => {
		const config = cfg({backend: 'searxng'});
		const getBackend = vi.fn((_name: string, _config: Config) => {
			return fakeBackend([]).backend;
		});
		await search(
			'q',
			{},
			{
				resolveConfig: () => config,
				buildDispatcher: () => undefined,
				createHttp: () => fakeHttp(),
				getBackend,
			},
		);
		expect(getBackend).toHaveBeenCalledWith('searxng', config);
	});

	it('allows a LOCAL+direct backend even when fetchEgress is socks5 (backend hop only)', async () => {
		// The blessed local-SearXNG + proxied-web_fetch topology: the backend-hop
		// guard inspects egress (direct) + baseUrl, NOT fetchEgress, so search runs.
		const {deps: d, calls} = deps(
			[{title: 'A', url: 'https://example.com/a'}],
			{
				resolveConfig: () =>
					cfg({
						baseUrl: 'http://127.0.0.1:8080',
						egress: {mode: 'direct'},
						fetchEgress: {mode: 'socks5', url: 'socks5h://127.0.0.1:1080'},
					}),
				// real assertEgressAllowsBaseUrl (default) must NOT throw here
			},
		);
		await expect(search('q', {}, d)).resolves.toHaveLength(1);
		expect(calls).toHaveLength(1);
	});

	it('FAILS LOUD when a non-direct BACKEND egress targets a loopback baseUrl', async () => {
		const getBackend = vi.fn();
		await expect(
			search(
				'q',
				{},
				{
					resolveConfig: () =>
						cfg({
							baseUrl: 'http://127.0.0.1:8080',
							egress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'},
						}),
					createHttp: () => fakeHttp(),
					getBackend: getBackend as never,
				},
			),
		).rejects.toThrow();
		expect(getBackend).not.toHaveBeenCalled();
	});

	it('FAILS LOUD when the dispatcher is unbuildable (never un-proxied)', async () => {
		const getBackend = vi.fn();
		await expect(
			search(
				'q',
				{},
				{
					resolveConfig: () =>
						cfg({egress: {mode: 'socks5', url: 'not a url'}}),
					createHttp: () => fakeHttp(),
					getBackend: getBackend as never,
				},
			),
		).rejects.toThrow();
		// The backend was never reached: the throw happened at dispatcher build.
		expect(getBackend).not.toHaveBeenCalled();
	});

	it('never reaches a global fetch through the whole flow', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('global fetch must not be called'));
		const {deps: d} = deps([{title: 'A', url: 'https://example.com/a'}]);
		await search('q', {}, d);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});
