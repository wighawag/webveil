// The default backend (task default-backend-searchcast): a fresh config is
// the searchcast backend on `direct` egress with the bundled Marginalia chain;
// any user engine setting replaces that chain whole; no trust rule changes;
// a missing library fails loud (search and fetch); a failed search and
// `webveil doctor` say the default changed. The chain runs for real (real
// searchcast, the real bundled recipe) against a LOCAL fake of the Marginalia
// API: no network.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo, Server} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSearchcast, SearchcastError} from 'searchcast';
import type {
	ChainTransport,
	Searchcast,
	SearchcastOptions,
	Transport,
	TransportSession,
} from 'searchcast';
import * as realInstall from 'searchcast/install';
import {
	BUNDLED_RECIPE,
	closeSearchcastInstances,
	createSearchcastBackend,
	describeSearchcastEngines,
} from '../src/core/backends/searchcast.js';
import {getBackend} from '../src/core/backends/registry.js';
import {
	DEFAULT_BACKEND_NOTE,
	resolveConfig,
	usesDefaultBackend,
} from '../src/core/config.js';
import {configProvenance} from '../src/core/layers.js';
import {assertEgressAllowsBaseUrl} from '../src/core/egress.js';
import {search} from '../src/core/search.js';
import {fetch} from '../src/core/fetch.js';
import {
	closeFetchTransports,
	createSearchcastFetch,
	resolveFetchTransport,
} from '../src/core/fetch-transport.js';
import {TrustError} from '../src/core/trust.js';
import {doctor} from '../src/setup.js';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://api.marginalia.nu';

let root: string;
let globalPath: string;
let project: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'webveil-default-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	mkdirSync(project, {recursive: true});
	saved = {
		XDG_STATE_HOME: process.env.XDG_STATE_HOME,
		XDG_DATA_HOME: process.env.XDG_DATA_HOME,
		MARGINALIA_API_KEY: process.env.MARGINALIA_API_KEY,
	};
	process.env.XDG_STATE_HOME = join(root, 'state');
	process.env.XDG_DATA_HOME = join(root, 'data');
	delete process.env.MARGINALIA_API_KEY;
});

afterEach(async () => {
	await closeSearchcastInstances();
	await closeFetchTransports();
	for (const [name, value] of Object.entries(saved))
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	rmSync(root, {recursive: true, force: true});
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

/** A fresh config: no project file, no global file, no env. */
const fresh = () => resolveConfig({cwd: project, globalPath, env: {}});

/** A declarative recipe named `alpha` (never run here). */
function writeAlpha(): string {
	const dir = join(root, 'recipes');
	writeJson(join(dir, 'alpha.json'), {
		navigate: {url: 'https://alpha.test/?q={query}'},
		ready: '.r',
		results: {
			item: '.r',
			fields: {title: {selector: 'a'}, url: {selector: 'a', attr: 'href'}},
		},
	});
	return dir;
}

describe('the default config', () => {
	it('is the searchcast backend on direct egress, backend set by the defaults', () => {
		const config = fresh();
		expect(config.backend).toBe('searchcast');
		expect(config.egress).toEqual({mode: 'direct'});
		expect(config.searchcast).toBeUndefined();
		expect(configProvenance(config)?.backend).toEqual({layer: 'defaults'});
		expect(usesDefaultBackend(config)).toBe(true);
		// web_fetch follows the backend: the impersonated transport.
		expect(resolveFetchTransport(config)).toBe('searchcast');
	});

	it('runs the bundled Marginalia code recipe, shipped in the package', async () => {
		expect(BUNDLED_RECIPE).toBe(join(pkgDir, 'recipes', 'marginalia.mjs'));
		expect(existsSync(BUNDLED_RECIPE)).toBe(true);
		expect(await describeSearchcastEngines(fresh())).toEqual([
			{name: 'marginalia', kind: 'code', file: BUNDLED_RECIPE},
		]);
	});

	it('takes a proxy egress: the unused loopback baseUrl does not trip the local-backend guard', () => {
		const config = resolveConfig({
			cwd: project,
			globalPath,
			env: {
				WEBVEIL_EGRESS: 'socks5',
				WEBVEIL_EGRESS_URL: 'socks5://127.0.0.1:9050',
			},
		});
		expect(config.baseUrl).toBe('http://127.0.0.1:8080');
		expect(() => assertEgressAllowsBaseUrl(config)).not.toThrow();
	});

	it('is not the default once any layer sets backend', () => {
		writeJson(globalPath, {backend: 'searchcast'});
		expect(usesDefaultBackend(fresh())).toBe(false);
		expect(
			usesDefaultBackend(
				resolveConfig({
					cwd: project,
					globalPath: join(root, 'none.json'),
					env: {WEBVEIL_BACKEND: 'searxng'},
				}),
			),
		).toBe(false);
	});

	it('`backend: "searxng"` alone restores the previous default', () => {
		writeJson(globalPath, {backend: 'searxng'});
		const config = fresh();
		expect(config).toMatchObject({
			backend: 'searxng',
			baseUrl: 'http://127.0.0.1:8080',
			egress: {mode: 'direct'},
		});
		expect(resolveFetchTransport(config)).toBe('plain');
	});
});

describe('user engine settings replace the default chain whole', () => {
	it('engines and recipes: only the user chain', async () => {
		writeJson(globalPath, {
			searchcast: {recipes: [writeAlpha()], engines: ['alpha']},
		});
		const engines = await describeSearchcastEngines(fresh());
		expect(engines.map((e) => e.name)).toEqual(['alpha']);
	});

	it('recipes alone: no default engines merged in (engines must be set)', async () => {
		writeJson(globalPath, {searchcast: {recipes: [writeAlpha()]}});
		await expect(describeSearchcastEngines(fresh())).rejects.toThrow(
			/set searchcast\.engines/,
		);
	});

	it('engines alone: the bundled recipe is not loaded', async () => {
		writeJson(globalPath, {searchcast: {engines: ['marginalia']}});
		await expect(describeSearchcastEngines(fresh())).rejects.toThrow(
			/unknown engine 'marginalia' \(loaded recipes: none\)/,
		);
	});

	it('code recipes alone (env): no default engines merged in', async () => {
		const config = resolveConfig({
			cwd: project,
			globalPath,
			env: {WEBVEIL_SEARCHCAST_CODE_RECIPES: BUNDLED_RECIPE},
		});
		await expect(describeSearchcastEngines(config)).rejects.toThrow(
			/set searchcast\.engines/,
		);
	});

	it('an empty engines list is still an error, not the default chain', async () => {
		writeJson(globalPath, {searchcast: {engines: []}});
		await expect(describeSearchcastEngines(fresh())).rejects.toThrow(
			/set searchcast\.engines/,
		);
	});

	it('a searchcast tuning key alone keeps the default chain', async () => {
		writeJson(globalPath, {searchcast: {cooldownMs: 1000}});
		expect(
			(await describeSearchcastEngines(fresh())).map((e) => e.name),
		).toEqual(['marginalia']);
	});
});

describe('no trust rule relaxed', () => {
	it('a project webveil.json still cannot add code recipes, the bundled file included', async () => {
		for (const codeRecipes of [[BUNDLED_RECIPE], ['./mine.mjs']]) {
			writeJson(join(project, 'webveil.json'), {
				searchcast: {codeRecipes, engines: ['marginalia']},
			});
			await expect(describeSearchcastEngines(fresh())).rejects.toThrow(
				TrustError,
			);
		}
	});

	it('a project webveil.json selecting the searchcast backend gets the bundled chain', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'searchcast'});
		expect(await describeSearchcastEngines(fresh())).toEqual([
			{name: 'marginalia', kind: 'code', file: BUNDLED_RECIPE},
		]);
	});
});

// ---- the chain against a local fake of the Marginalia API ----------------

let server: Server | undefined;
afterEach(async () => {
	if (server) await new Promise((r) => server!.close(r));
	server = undefined;
});

/**
 * A local fake of the Marginalia API (`/<key>/search/<query>`): 200 with
 * results, or `status`. Returns its base URL and the paths requested.
 */
async function fakeApi(status = 200) {
	const paths: string[] = [];
	server = createServer((req, res) => {
		paths.push(req.url ?? '');
		res.statusCode = status;
		res.setHeader('content-type', 'application/json');
		const query = decodeURIComponent((req.url ?? '').split('/')[3] ?? '');
		res.end(
			JSON.stringify({
				results: [
					{
						url: 'https://one.example/',
						title: `One about ${query}`,
						description: 'the first',
					},
					{url: 'https://two.example/', title: '', description: ''},
					{title: 'no url'},
				],
			}),
		);
	});
	await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {base, paths};
}

/** A transport that sends the API's requests to the local fake instead. */
function redirectTo(base: string): ChainTransport {
	return {
		session(): TransportSession {
			return {
				async request(url: string) {
					if (!url.startsWith(`${API}/`))
						throw new Error(`unexpected request ${url}`);
					const r = await globalThis.fetch(base + url.slice(API.length));
					const text = await r.text();
					return {
						url,
						status: r.status,
						headers: r.headers,
						body: new TextEncoder().encode(text),
						text: () => text,
					};
				},
				cookies: () => [],
				clearCookies() {},
			} as unknown as TransportSession;
		},
	};
}

/** Search with the fresh config, real searchcast over `transport`. */
function searchFresh(
	transport: ChainTransport,
	built: SearchcastOptions[] = [],
) {
	return search(
		'hello world',
		{cwd: project, globalPath, env: {}},
		{
			getBackend: (name, config) =>
				name === 'searchcast'
					? createSearchcastBackend(config, {
							createSearchcast: (options): Searchcast => {
								built.push(options);
								return createSearchcast({...options, transport});
							},
						})
					: getBackend(name, config),
		},
	);
}

describe('a search through the default chain (local fake API, no network)', () => {
	it('returns the API results, with the shared public key, strict and direct', async () => {
		const api = await fakeApi();
		const built: SearchcastOptions[] = [];
		const results = await searchFresh(redirectTo(api.base), built);
		expect(results).toEqual([
			{
				title: 'One about hello world',
				url: 'https://one.example/',
				snippet: 'the first',
			},
			{title: 'https://two.example/', url: 'https://two.example/'},
		]);
		expect(api.paths).toEqual(['/public/search/hello%20world']);
		expect(built[0]).toMatchObject({strict: true, proxy: undefined});
	});

	it('uses MARGINALIA_API_KEY when set', async () => {
		process.env.MARGINALIA_API_KEY = 'my key';
		const api = await fakeApi();
		await searchFresh(redirectTo(api.base));
		expect(api.paths).toEqual(['/my%20key/search/hello%20world']);
	});

	it('a failed search says the default changed and how to restore SearXNG', async () => {
		const api = await fakeApi(503);
		const error = await searchFresh(redirectTo(api.base)).catch(
			(e: Error) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/every engine failed: marginalia/);
		expect((error as Error).message).toContain(DEFAULT_BACKEND_NOTE);
		expect(DEFAULT_BACKEND_NOTE).toContain('"backend": "searxng"');
	});

	it('an explicitly chosen backend gets no such note', async () => {
		writeJson(globalPath, {backend: 'searchcast'});
		const api = await fakeApi(503);
		const error = await searchFresh(redirectTo(api.base)).catch(
			(e: Error) => e,
		);
		expect((error as Error).message).not.toContain(DEFAULT_BACKEND_NOTE);
	});
});

// ---- no silent fallback when the library is missing -------------------------

const missing = () =>
	new SearchcastError('impersonation', 'libcurl-impersonate not found (test)');

describe('no library: search and fetch fail loud, never a Node fingerprint', () => {
	it('search: the impersonation error with its fix, and the default note', async () => {
		const transport: ChainTransport = {
			session: () =>
				({
					request: async () => Promise.reject(missing()),
					cookies: () => [],
					clearCookies() {},
				}) as unknown as TransportSession,
		};
		const error = (await searchFresh(transport).catch(
			(e: Error) => e,
		)) as Error;
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toMatch(/impersonation is not active/);
		expect(error.message).toContain('webveil install-libcurl');
		expect(error.message).toContain(DEFAULT_BACKEND_NOTE);
	});

	it('fetch: the impersonation error names install-libcurl and fetchTransport plain; the plain transport is never built', async () => {
		let plainBuilt = 0;
		const transport = {
			check: async () => Promise.reject(missing()),
			session: () =>
				({
					request: async () => Promise.reject(missing()),
					cookies: () => [],
					clearCookies() {},
					documentCookies: {},
					close() {},
				}) as unknown as TransportSession,
		} as unknown as Transport;
		const error = (await fetch(
			'https://page.example/',
			{cwd: project, globalPath, env: {}},
			{
				createEgressFetch: () => {
					plainBuilt++;
					throw new Error('the plain transport must not be used');
				},
				createSearchcastFetch: (config) =>
					createSearchcastFetch(config, {
						createTransport: () => transport,
						assertPublicUrl: async () => {},
					}),
			},
		).catch((e: Error) => e)) as Error;
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toMatch(/impersonation is not active/);
		expect(error.message).toContain('webveil install-libcurl');
		expect(error.message).toContain('"fetchTransport": "plain"');
		expect(plainBuilt).toBe(0);
	});
});

// ---- doctor ---------------------------------------------------------------

describe('webveil doctor with the default backend', () => {
	it('adds the defaultBackend notice (not a problem) and lists the bundled engine', async () => {
		const result = await doctor(
			{},
			{loadInstall: async () => realInstall, resolveConfig: fresh},
		);
		expect(result.backend).toBe('searchcast');
		expect(result.defaultBackend).toBe(DEFAULT_BACKEND_NOTE);
		expect(result.problems.join(' ')).not.toContain('default backend');
		expect(result.engines).toEqual([
			{name: 'marginalia', kind: 'code', file: BUNDLED_RECIPE},
		]);
	});

	it('has no notice once the backend is set', async () => {
		writeJson(globalPath, {backend: 'searxng'});
		const result = await doctor(
			{},
			{loadInstall: async () => realInstall, resolveConfig: fresh},
		);
		expect(result).not.toHaveProperty('defaultBackend');
	});
});

// ---- the published tarball ------------------------------------------------

describe('the webveil tarball', () => {
	it('ships the bundled recipe', () => {
		const res = spawnSync(
			'npm',
			['pack', '--dry-run', '--json', '--ignore-scripts'],
			{cwd: pkgDir, encoding: 'utf8', timeout: 60_000},
		);
		expect(res.status).toBe(0);
		const [pack] = JSON.parse(res.stdout) as [{files: {path: string}[]}];
		expect(pack.files.map((f) => f.path)).toContain('recipes/marginalia.mjs');
	});
});
