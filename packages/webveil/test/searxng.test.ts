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
