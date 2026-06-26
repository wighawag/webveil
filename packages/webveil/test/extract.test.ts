import {describe, expect, it, vi} from 'vitest';
import {extract, type ExtractDeps} from '../src/core/extract.js';
import type {Config, FetchSize} from '../src/core/config.js';
import type {EgressFetch} from '../src/core/egress.js';

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
 * A spy egress fetch: a UNIQUE, identifiable function that is NEVER the global
 * `fetch`. The seam must hand exactly THIS to distilly, proving distilly reaches
 * the network only through webveil's egress.
 */
function spyEgressFetch(): EgressFetch {
	const f = vi.fn(async () =>
		Promise.reject(
			new Error('extractor test: egress fetch must not be called'),
		),
	);
	return f as unknown as EgressFetch;
}

/** A spy `urlToMarkdown` returning a fixed result, recording how it was called. */
function spyUrlToMarkdown(result = {markdown: '# hi', truncated: false}) {
	return vi.fn(async (_url: string | URL, _options: unknown) => result);
}

describe('extract (Extractor seam)', () => {
	it('injects webveil egress fetch into distilly — never a global fetch', async () => {
		const fetch = spyEgressFetch();
		const urlToMarkdown = spyUrlToMarkdown();
		const deps: ExtractDeps = {
			urlToMarkdown,
			createEgressFetch: () => fetch,
		};

		await extract('https://example.com/p', cfg(), {}, deps);

		expect(urlToMarkdown).toHaveBeenCalledTimes(1);
		const [calledUrl, calledOptions] = urlToMarkdown.mock.calls[0]!;
		expect(calledUrl).toBe('https://example.com/p');
		// The EXACT egress fetch instance is injected, not the global.
		expect((calledOptions as {fetch: unknown}).fetch).toBe(fetch);
		expect((calledOptions as {fetch: unknown}).fetch).not.toBe(
			globalThis.fetch,
		);
	});

	it('builds the egress fetch from THIS config (egress is config-bound)', async () => {
		const fetch = spyEgressFetch();
		const build = vi.fn(() => fetch);
		const config = cfg({egress: {mode: 'http', url: 'http://127.0.0.1:8118'}});

		await extract(
			'https://example.com',
			config,
			{},
			{urlToMarkdown: spyUrlToMarkdown(), createEgressFetch: build},
		);

		expect(build).toHaveBeenCalledTimes(1);
		expect(build).toHaveBeenCalledWith(config);
	});

	it('maps the config fetchSize preset straight to distilly size', async () => {
		for (const size of ['s', 'm', 'l', 'f'] as FetchSize[]) {
			const urlToMarkdown = spyUrlToMarkdown();
			await extract(
				'https://example.com',
				cfg({fetchSize: size}),
				{},
				{urlToMarkdown, createEgressFetch: () => spyEgressFetch()},
			);
			const [, options] = urlToMarkdown.mock.calls[0]!;
			expect((options as {size: FetchSize}).size).toBe(size);
		}
	});

	it('per-call size overrides the config fetchSize', async () => {
		const urlToMarkdown = spyUrlToMarkdown();
		await extract(
			'https://example.com',
			cfg({fetchSize: 'm'}),
			{size: 'l'},
			{urlToMarkdown, createEgressFetch: () => spyEgressFetch()},
		);
		const [, options] = urlToMarkdown.mock.calls[0]!;
		expect((options as {size: FetchSize}).size).toBe('l');
	});

	it('surfaces distilly markdown + truncated in the FetchResult', async () => {
		const urlToMarkdown = spyUrlToMarkdown({
			markdown: '# Title\n\nbody',
			truncated: true,
		});
		const result = await extract(
			'https://example.com/x',
			cfg(),
			{},
			{urlToMarkdown, createEgressFetch: () => spyEgressFetch()},
		);
		expect(result).toEqual({
			url: 'https://example.com/x',
			markdown: '# Title\n\nbody',
			truncated: true,
		});
	});

	it('passes truncated=false through unchanged', async () => {
		const urlToMarkdown = spyUrlToMarkdown({markdown: 'm', truncated: false});
		const result = await extract(
			'https://example.com',
			cfg(),
			{},
			{urlToMarkdown, createEgressFetch: () => spyEgressFetch()},
		);
		expect(result.truncated).toBe(false);
	});

	it('FAILS LOUD when the egress fetch is unbuildable (never un-proxied)', async () => {
		// Use the REAL createEgressFetch via an unbuildable socks5 proxy: it must
		// throw BEFORE distilly is ever reached, so no un-proxied request happens.
		const urlToMarkdown = spyUrlToMarkdown();
		await expect(
			extract(
				'https://example.com',
				cfg({egress: {mode: 'socks5', url: 'not a url'}}),
				{},
				{urlToMarkdown},
			),
		).rejects.toThrow();
		// distilly was never invoked: the throw happened at egress-fetch build.
		expect(urlToMarkdown).not.toHaveBeenCalled();
	});

	it('propagates distilly fail-loud when no fetch reaches it (real distilly)', async () => {
		// Sanity: distilly itself throws when handed a non-fetch. We force that by
		// injecting a createEgressFetch that yields a non-function, proving the
		// real distilly/fetch refuses rather than reaching for a global.
		await expect(
			extract(
				'https://example.com',
				cfg(),
				{},
				{createEgressFetch: () => undefined as unknown as EgressFetch},
			),
		).rejects.toThrow();
	});
});
