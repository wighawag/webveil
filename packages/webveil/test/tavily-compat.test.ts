import {afterEach, describe, expect, it, vi} from 'vitest';
import {createTavilyCompatBackend} from '../src/core/backends/tavily-compat.js';
import type {Config} from '../src/core/config.js';
import type {Http, HttpRequestOptions} from '../src/core/backends/types.js';

const config: Config = {
	backend: 'tavily-compat',
	baseUrl: 'https://orio-search.example',
	apiKey: 'tvly-test-key',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

// A realistic Tavily-shaped `/search` payload: a `results` array whose entries
// carry title/url/content/score, alongside metadata we ignore (answer, images,
// response_time, request_id).
const SEARCH_PAYLOAD = {
	query: 'webveil',
	answer: 'An anonymous web search tool.',
	images: [],
	results: [
		{
			title: 'Result A',
			url: 'https://example.com/a',
			content: 'Snippet for A',
			score: 0.91,
			raw_content: null,
		},
		{
			title: 'Result B',
			url: 'https://example.com/b',
			content: 'Snippet for B',
			score: 0.82,
		},
	],
	response_time: 1.09,
	request_id: '123e4567-e89b-12d3-a456-426614174111',
};

// A realistic Tavily-shaped `/extract` payload: a `results` array of extracted
// pages (url + raw_content) plus a `failed_results` array we ignore here.
const EXTRACT_PAYLOAD = {
	results: [
		{
			url: 'https://example.com/page',
			raw_content: '# Page\n\nExtracted markdown body.',
			images: [],
			favicon: 'https://example.com/favicon.ico',
		},
	],
	failed_results: [],
	response_time: 0.42,
	request_id: '123e4567-e89b-12d3-a456-426614174111',
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

describe('tavily-compat backend — /search', () => {
	it('parses a realistic Tavily /search response into SearchResult[]', async () => {
		const {http} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
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

	it('POSTs the query to /search against the baseUrl with a JSON body', async () => {
		const {http, calls} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		await backend.search('hello world', http);
		expect(calls).toHaveLength(1);
		const call = calls[0]!;
		expect(new URL(call.url).origin).toBe('https://orio-search.example');
		expect(new URL(call.url).pathname).toBe('/search');
		expect(call.options?.method).toBe('POST');
		const body = JSON.parse(call.options?.body ?? '{}');
		expect(body.query).toBe('hello world');
	});

	it('sends a bearer Authorization header when an apiKey is configured', async () => {
		const {http, calls} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		await backend.search('q', http);
		const headers = calls[0]!.options?.headers ?? {};
		expect(headers.authorization).toBe('Bearer tvly-test-key');
		expect(headers['content-type']).toBe('application/json');
	});

	it('omits the Authorization header when no apiKey is configured (keyless compat)', async () => {
		const {http, calls} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend({...config, apiKey: undefined});
		await backend.search('q', http);
		const headers = calls[0]!.options?.headers ?? {};
		expect(headers.authorization).toBeUndefined();
	});

	it('passes max_results in the body and clamps the parsed results', async () => {
		const {http, calls} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		const results = await backend.search('webveil', http, {maxResults: 1});
		const body = JSON.parse(calls[0]!.options?.body ?? '{}');
		expect(body.max_results).toBe(1);
		expect(results).toEqual([
			{
				title: 'Result A',
				url: 'https://example.com/a',
				snippet: 'Snippet for A',
			},
		]);
	});

	it('drops entries missing a url or title, and omits empty snippets', async () => {
		const {http} = fakeHttp({
			results: [
				{url: 'https://example.com/ok', title: 'Has both'},
				{title: 'No url'},
				{url: 'https://example.com/no-title'},
				{url: 'https://example.com/empty', title: 'Empty', content: ''},
			],
		});
		const backend = createTavilyCompatBackend(config);
		const results = await backend.search('q', http);
		expect(results).toEqual([
			{title: 'Has both', url: 'https://example.com/ok'},
			{title: 'Empty', url: 'https://example.com/empty'},
		]);
	});

	it('tolerates a response with no results array', async () => {
		const {http} = fakeHttp({query: 'x'});
		const backend = createTavilyCompatBackend(config);
		expect(await backend.search('x', http)).toEqual([]);
	});

	it('forwards an abort signal to the http helper', async () => {
		const {http, calls} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		const controller = new AbortController();
		await backend.search('q', http, {signal: controller.signal});
		expect(calls[0]!.options?.signal).toBe(controller.signal);
	});

	it('never reaches a global fetch (egress cannot be bypassed)', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('global fetch must not be called'));
		const {http} = fakeHttp(SEARCH_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		await backend.search('webveil', http);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('tavily-compat backend — /extract (optional Backend.fetch)', () => {
	it('exposes fetch (the optional Backend.fetch)', () => {
		const backend = createTavilyCompatBackend(config);
		expect(typeof backend.fetch).toBe('function');
	});

	it('parses a Tavily /extract response into a FetchResult', async () => {
		const {http} = fakeHttp(EXTRACT_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		const page = await backend.fetch!('https://example.com/page', http);
		expect(page).toEqual({
			url: 'https://example.com/page',
			markdown: '# Page\n\nExtracted markdown body.',
			truncated: false,
		});
	});

	it('POSTs the url to /extract against the baseUrl with a JSON body', async () => {
		const {http, calls} = fakeHttp(EXTRACT_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		await backend.fetch!('https://example.com/page', http);
		const call = calls[0]!;
		expect(new URL(call.url).pathname).toBe('/extract');
		expect(call.options?.method).toBe('POST');
		const body = JSON.parse(call.options?.body ?? '{}');
		expect(body.urls).toBe('https://example.com/page');
		expect(body.format).toBe('markdown');
	});

	it('sends a bearer Authorization header on /extract too', async () => {
		const {http, calls} = fakeHttp(EXTRACT_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		await backend.fetch!('https://example.com/page', http);
		const headers = calls[0]!.options?.headers ?? {};
		expect(headers.authorization).toBe('Bearer tvly-test-key');
	});

	it('throws clearly when the url is in failed_results', async () => {
		const {http} = fakeHttp({
			results: [],
			failed_results: [
				{url: 'https://example.com/page', error: 'could not fetch'},
			],
		});
		const backend = createTavilyCompatBackend(config);
		await expect(
			backend.fetch!('https://example.com/page', http),
		).rejects.toThrow(/could not fetch/);
	});

	it('throws clearly when no extract result is returned', async () => {
		const {http} = fakeHttp({results: [], failed_results: []});
		const backend = createTavilyCompatBackend(config);
		await expect(
			backend.fetch!('https://example.com/page', http),
		).rejects.toThrow(/no extract result/i);
	});

	it('forwards an abort signal to the http helper on /extract', async () => {
		const {http, calls} = fakeHttp(EXTRACT_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		const controller = new AbortController();
		await backend.fetch!('https://example.com/page', http, {
			signal: controller.signal,
		});
		expect(calls[0]!.options?.signal).toBe(controller.signal);
	});

	it('never reaches a global fetch on /extract (egress cannot be bypassed)', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('global fetch must not be called'));
		const {http} = fakeHttp(EXTRACT_PAYLOAD);
		const backend = createTavilyCompatBackend(config);
		await backend.fetch!('https://example.com/page', http);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});
