import {afterEach, describe, expect, it, vi} from 'vitest';
import {createSearxngBackend} from '../src/core/backends/searxng.js';
import type {Config} from '../src/core/config.js';
import type {Http, HttpRequestOptions} from '../src/core/backends/types.js';

const config: Config = {
	backend: 'searxng',
	baseUrl: 'http://127.0.0.1:8080',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

// A realistic SearXNG JSON payload (`/search?format=json`): a `results` array
// whose entries carry url/title/content, alongside metadata we ignore.
const SEARXNG_PAYLOAD = {
	query: 'webveil',
	number_of_results: 2,
	results: [
		{
			url: 'https://example.com/a',
			title: 'Result A',
			content: 'Snippet for A',
			engine: 'duckduckgo',
			score: 1.5,
			category: 'general',
		},
		{
			url: 'https://example.com/b',
			title: 'Result B',
			content: 'Snippet for B',
			engine: 'google',
			score: 1.2,
		},
	],
	suggestions: ['webveil tool'],
};

/** A fake `http` helper recording calls; never touches the network. */
function fakeHttp(payload: unknown): {
	http: Http;
	calls: {url: string; options?: HttpRequestOptions}[];
} {
	const calls: {url: string; options?: HttpRequestOptions}[] = [];
	const http: Http = {
		async fetchJson<T>(url: string, options?: HttpRequestOptions): Promise<T> {
			calls.push({url, options});
			return payload as T;
		},
		async fetchText(
			url: string,
			options?: HttpRequestOptions,
		): Promise<string> {
			calls.push({url, options});
			return '';
		},
	};
	return {http, calls};
}

describe('searxng backend', () => {
	it('parses a realistic SearXNG JSON response into SearchResult[]', async () => {
		const {http} = fakeHttp(SEARXNG_PAYLOAD);
		const backend = createSearxngBackend(config);
		const results = await backend.search('webveil', http);
		expect(results).toEqual([
			{
				title: 'Result A',
				url: 'https://example.com/a',
				snippet: 'Snippet for A',
			},
			{
				title: 'Result B',
				url: 'https://example.com/b',
				snippet: 'Snippet for B',
			},
		]);
	});

	it('queries the instance JSON API via the baseUrl', async () => {
		const {http, calls} = fakeHttp(SEARXNG_PAYLOAD);
		const backend = createSearxngBackend(config);
		await backend.search('hello world', http);
		expect(calls).toHaveLength(1);
		const url = new URL(calls[0]!.url);
		expect(url.origin).toBe('http://127.0.0.1:8080');
		expect(url.pathname).toBe('/search');
		expect(url.searchParams.get('q')).toBe('hello world');
		expect(url.searchParams.get('format')).toBe('json');
	});

	it('drops entries missing a url or title, and omits empty snippets', async () => {
		const {http} = fakeHttp({
			results: [
				{url: 'https://example.com/ok', title: 'Has both'},
				{title: 'No url'},
				{url: 'https://example.com/no-title'},
				{url: 'https://example.com/empty', title: 'Empty snippet', content: ''},
			],
		});
		const backend = createSearxngBackend(config);
		const results = await backend.search('q', http);
		expect(results).toEqual([
			{title: 'Has both', url: 'https://example.com/ok'},
			{title: 'Empty snippet', url: 'https://example.com/empty'},
		]);
	});

	it('tolerates a response with no results array', async () => {
		const {http} = fakeHttp({query: 'x'});
		const backend = createSearxngBackend(config);
		expect(await backend.search('x', http)).toEqual([]);
	});

	it('clamps to maxResults when given', async () => {
		const {http} = fakeHttp(SEARXNG_PAYLOAD);
		const backend = createSearxngBackend(config);
		const results = await backend.search('webveil', http, {maxResults: 1});
		expect(results).toEqual([
			{
				title: 'Result A',
				url: 'https://example.com/a',
				snippet: 'Snippet for A',
			},
		]);
	});

	it('forwards an abort signal to the http helper', async () => {
		const {http, calls} = fakeHttp(SEARXNG_PAYLOAD);
		const backend = createSearxngBackend(config);
		const controller = new AbortController();
		await backend.search('q', http, {signal: controller.signal});
		expect(calls[0]!.options?.signal).toBe(controller.signal);
	});

	// Engine-degradation surfacing (live incident 2026-09-16: every curated
	// engine refused or poisoned the box's egress IP; the response carried no
	// usable degradation signal for clients). These tests use fixture payloads —
	// never a live engine.
	describe('unresponsive_engines', () => {
		// Upstream shape (`searx/webutils.get_translated_errors`): a JSON pair
		// [engineName, errorMessage] per failed engine (a serialized Python tuple).
		const DEGRADED_PAYLOAD = {
			...SEARXNG_PAYLOAD,
			unresponsive_engines: [
				['brave', 'Suspended: too many requests'],
				['duckduckgo', 'CAPTCHA'],
			],
		};

		it('ANNOTATES every result when SOME engines are down (partial is still useful)', async () => {
			const {http} = fakeHttp(DEGRADED_PAYLOAD);
			const backend = createSearxngBackend(config);
			const results = await backend.search('webveil', http);
			expect(results).toHaveLength(2);
			for (const r of results)
				expect(r.unresponsiveEngines).toEqual(['brave', 'duckduckgo']);
		});

		it('keeps the annotation on clamped results', async () => {
			const {http} = fakeHttp(DEGRADED_PAYLOAD);
			const backend = createSearxngBackend(config);
			const results = await backend.search('webveil', http, {maxResults: 1});
			expect(results).toHaveLength(1);
			expect(results[0]!.unresponsiveEngines).toEqual(['brave', 'duckduckgo']);
		});

		it('FAILS LOUD when no results came back and engines are unresponsive (full outage)', async () => {
			const {http} = fakeHttp({
				query: 'gfx1151 rocm',
				results: [],
				unresponsive_engines: [
					['bing', 'HTTP 403'],
					['brave', 'Suspended: too many requests'],
					['duckduckgo', 'CAPTCHA'],
					['mojeek', 'HTTP 403'],
					['startpage', 'Suspended: CAPTCHA'],
				],
			});
			const backend = createSearxngBackend(config);
			// The existing unavailable/fail-loud path: a thrown Error (like http
			// failures), never a confident empty answer.
			await expect(backend.search('gfx1151 rocm', http)).rejects.toThrow(
				/searxng: no results and engines unresponsive \(bing, brave, duckduckgo, mojeek, startpage\).*docs\/searxng-setup\.md/,
			);
		});

		it('still returns [] for a genuine no-hit query on a healthy instance', async () => {
			const {http} = fakeHttp({query: 'zzz-no-hits', results: []});
			const backend = createSearxngBackend(config);
			expect(await backend.search('zzz-no-hits', http)).toEqual([]);
		});

		it('adds NO annotation when no engine failed (a clean answer)', async () => {
			const {http} = fakeHttp(SEARXNG_PAYLOAD);
			const backend = createSearxngBackend(config);
			const results = await backend.search('webveil', http);
			for (const r of results) expect(r.unresponsiveEngines).toBeUndefined();
		});

		it('tolerates upstream shape drift (strings, {name} objects, garbage)', async () => {
			const {http} = fakeHttp({
				results: [{url: 'https://example.com/a', title: 'Result A'}],
				unresponsive_engines: [
					'mojeek',
					{name: 'brave', error: 'too many requests'},
					{engine: 'shape-we-do-not-know'},
					['duckduckgo', 'CAPTCHA'],
					42,
				],
			});
			const backend = createSearxngBackend(config);
			const results = await backend.search('q', http);
			expect(results[0]!.unresponsiveEngines).toEqual([
				'mojeek',
				'brave',
				'duckduckgo',
			]);
		});
	});

	it('never reaches a global fetch (egress cannot be bypassed)', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('global fetch must not be called'));
		const {http} = fakeHttp(SEARXNG_PAYLOAD);
		const backend = createSearxngBackend(config);
		await backend.search('webveil', http);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});
