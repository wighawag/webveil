import {afterEach, describe, expect, it} from 'vitest';
import {Agent} from 'undici';
import {
	isUnixBaseUrl,
	parseUnixBaseUrl,
	resolveBackendTransport,
} from '../src/core/baseurl.js';

describe('isUnixBaseUrl', () => {
	it('recognizes the unix: scheme', () => {
		expect(isUnixBaseUrl('unix:/run/socket')).toBe(true);
		expect(isUnixBaseUrl('unix:/run/socket:/searxng')).toBe(true);
	});

	it('rejects ordinary http(s) baseUrls', () => {
		expect(isUnixBaseUrl('http://127.0.0.1:8080')).toBe(false);
		expect(isUnixBaseUrl('https://example.com')).toBe(false);
	});
});

describe('parseUnixBaseUrl', () => {
	it('parses socket path with no httpPath (defaults to /)', () => {
		expect(parseUnixBaseUrl('unix:/usr/local/searxng/run/socket')).toEqual({
			socketPath: '/usr/local/searxng/run/socket',
			httpPath: '/',
		});
	});

	it('parses an explicit base path (mount point)', () => {
		expect(parseUnixBaseUrl('unix:/run/socket:/searxng')).toEqual({
			socketPath: '/run/socket',
			httpPath: '/searxng',
		});
	});

	it('normalizes a base path that lacks a leading slash', () => {
		expect(parseUnixBaseUrl('unix:/run/socket:searxng')).toEqual({
			socketPath: '/run/socket',
			httpPath: '/searxng',
		});
	});

	it('treats a trailing empty httpPath as /', () => {
		expect(parseUnixBaseUrl('unix:/run/socket:')).toEqual({
			socketPath: '/run/socket',
			httpPath: '/',
		});
	});

	it('splits on the FIRST colon (socket paths carry no colon)', () => {
		expect(parseUnixBaseUrl('unix:/run/socket:/a/b')).toEqual({
			socketPath: '/run/socket',
			httpPath: '/a/b',
		});
	});

	it('throws on an empty socket path', () => {
		expect(() => parseUnixBaseUrl('unix:')).toThrow(/socket path/);
		expect(() => parseUnixBaseUrl('unix::/searxng')).toThrow(/socket path/);
	});
});

describe('resolveBackendTransport', () => {
	const agents: Agent[] = [];
	afterEach(async () => {
		await Promise.all(agents.splice(0).map((a) => a.close()));
	});

	it('is a no-op for a normal TCP baseUrl (no per-hop dispatcher)', () => {
		const t = resolveBackendTransport('http://127.0.0.1:8080');
		expect(t.baseUrl).toBe('http://127.0.0.1:8080');
		expect(t.dispatcher).toBeUndefined();
	});

	it('rewrites a unix: baseUrl to a synthetic http://localhost base + socket Agent', () => {
		const t = resolveBackendTransport('unix:/run/socket');
		agents.push(t.dispatcher as Agent);
		// httpPath defaults to /, so the synthetic base is bare http://localhost
		// (the backend then appends `search` -> http://localhost/search).
		expect(t.baseUrl).toBe('http://localhost');
		expect(t.dispatcher).toBeInstanceOf(Agent);
	});

	it('carries a non-root mount point into the synthetic base', () => {
		const t = resolveBackendTransport('unix:/run/socket:/searxng');
		agents.push(t.dispatcher as Agent);
		expect(t.baseUrl).toBe('http://localhost/searxng');
	});
});
