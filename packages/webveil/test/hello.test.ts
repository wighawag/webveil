import {it, describe, expect} from 'vitest';
import {search, fetch} from '../src/index.js';
import type {Config} from '../src/core/config.js';

describe('webveil core', () => {
	it('exposes search wired to the core (returns normalized results)', async () => {
		const config: Config = {
			backend: 'searxng',
			baseUrl: 'http://127.0.0.1:8080',
			egress: {mode: 'direct'},
			fetchSize: 'm',
		};
		const hit = {title: 'A', url: 'https://example.com/a'};
		const results = await search(
			'hello',
			{},
			{
				resolveConfig: () => config,
				buildDispatcher: () => undefined,
				createHttp: () => ({
					async fetchJson() {
						throw new Error('not used');
					},
					async fetchText() {
						throw new Error('not used');
					},
				}),
				getBackend: () => ({
					async search() {
						return [hit];
					},
				}),
			},
		);
		expect(results).toEqual([hit]);
	});
	it('exposes fetch (not yet implemented)', async () => {
		await expect(fetch('https://example.com')).rejects.toThrow(
			/not implemented/,
		);
	});
});
