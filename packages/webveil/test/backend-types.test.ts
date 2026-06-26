import {describe, expect, it} from 'vitest';
import type {Backend, FetchResult, Http, SearchResult} from '../src/index.js';

// The Backend interface + result types are exported foundation only: consumed by
// no real backend yet. This test exercises the contract via a tiny in-test
// implementation, proving the shapes line up.

describe('backend seam types', () => {
	it('a Backend can be implemented against the exported types', async () => {
		const fakeHttp: Http = {
			async fetchJson<T>() {
				return {results: []} as T;
			},
			async fetchText() {
				return '';
			},
		};

		const backend: Backend = {
			async search(query, http): Promise<SearchResult[]> {
				expect(http).toBe(fakeHttp); // backend receives the proxied http
				return [{title: 'x', url: `https://example.com/${query}`}];
			},
			async fetch(url): Promise<FetchResult> {
				return {url, markdown: '# x', truncated: false};
			},
		};

		const results = await backend.search('q', fakeHttp);
		expect(results[0]?.url).toBe('https://example.com/q');
		const page = await backend.fetch!('https://example.com', fakeHttp);
		expect(page.truncated).toBe(false);
	});
});
