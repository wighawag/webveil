import {describe, expect, it} from 'vitest';
import {backendNames, getBackend} from '../src/core/backends/registry.js';
import type {Config} from '../src/core/config.js';

const config: Config = {
	backend: 'searxng',
	baseUrl: 'http://127.0.0.1:8080',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

describe('backend registry', () => {
	it("resolves 'searxng' to a Backend with a search method", () => {
		const backend = getBackend('searxng', config);
		expect(typeof backend.search).toBe('function');
	});

	it("resolves 'tavily-compat' to a Backend with search + fetch", () => {
		const backend = getBackend('tavily-compat', config);
		expect(typeof backend.search).toBe('function');
		expect(typeof backend.fetch).toBe('function');
	});

	it("resolves 'custom' to a Backend with a search method", () => {
		const backend = getBackend('custom', {...config, baseUrl: 'true'});
		expect(typeof backend.search).toBe('function');
	});

	it('lists searxng, tavily-compat and custom among its known names', () => {
		expect(backendNames()).toContain('searxng');
		expect(backendNames()).toContain('tavily-compat');
		expect(backendNames()).toContain('custom');
	});

	it('fails clearly on an unknown name (and names the known ones)', () => {
		expect(() => getBackend('nope', config)).toThrow(/unknown backend 'nope'/);
		expect(() => getBackend('nope', config)).toThrow(/searxng/);
	});
});
