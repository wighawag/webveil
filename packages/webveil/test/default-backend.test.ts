// The default backend (task default-backend-searchcast): a fresh config is
// the searchcast backend on `direct` egress with the bundled default chain
// (Mwmbl then Marginalia since task default-chain-mwmbl);
// any user engine setting replaces that chain whole; no trust rule changes;
// a missing library fails loud (search and fetch); a failed search and
// `webveil doctor` say the default changed. The chain runs for real (real
// searchcast, the real bundled recipes) against LOCAL fakes of the Mwmbl and
// Marginalia APIs: no network.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
	RequestOptions,
	Searchcast,
	SearchcastOptions,
	Transport,
	TransportSession,
} from 'searchcast';
import * as realInstall from 'searchcast/install';
import {
	BUNDLED_RECIPES,
	closeSearchcastInstances,
	createSearchcastBackend,
	DEFAULT_CHAIN_NOTE,
	DEFAULT_ENGINES,
	describeSearchcastEngines,
	usesDefaultSearchcastChain,
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
const MWMBL_API = 'https://api.mwmbl.org/api/v2/search/';
const MARGINALIA_API = 'https://api.marginalia.nu';
/** Marginalia's current API, called (with an `API-Key` header) only with a key. */
const MARGINALIA_API2 = 'https://api2.marginalia-search.com';
const MWMBL_RECIPE = join(pkgDir, 'recipes', 'mwmbl.mjs');
const MARGINALIA_RECIPE = join(pkgDir, 'recipes', 'marginalia.mjs');
/** What `describeSearchcastEngines` lists for the default chain. */
const DEFAULT_CHAIN = [
	{name: 'mwmbl', kind: 'code', file: MWMBL_RECIPE},
	{name: 'marginalia', kind: 'code', file: MARGINALIA_RECIPE},
];

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
		MWMBL_API_KEY: process.env.MWMBL_API_KEY,
	};
	process.env.XDG_STATE_HOME = join(root, 'state');
	process.env.XDG_DATA_HOME = join(root, 'data');
	delete process.env.MARGINALIA_API_KEY;
	delete process.env.MWMBL_API_KEY;
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

	it('runs the bundled chain, Mwmbl then Marginalia, from code recipes shipped in the package', async () => {
		expect(DEFAULT_ENGINES).toEqual(['mwmbl', 'marginalia']);
		expect(BUNDLED_RECIPES).toEqual([MWMBL_RECIPE, MARGINALIA_RECIPE]);
		for (const file of BUNDLED_RECIPES) expect(existsSync(file)).toBe(true);
		expect(usesDefaultSearchcastChain(fresh())).toBe(true);
		expect(await describeSearchcastEngines(fresh())).toEqual(DEFAULT_CHAIN);
	});

	it('records the searchcast commit each bundled recipe was copied from', () => {
		for (const file of BUNDLED_RECIPES)
			expect(readFileSync(file, 'utf8')).toMatch(
				/github\.com\/wighawag\/searchcast\/blob\/[0-9a-f]{40}\/examples\/recipes\//,
			);
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

	it('engines alone: the bundled recipes are not loaded', async () => {
		for (const name of DEFAULT_ENGINES) {
			writeJson(globalPath, {searchcast: {engines: [name]}});
			const config = fresh();
			expect(usesDefaultSearchcastChain(config)).toBe(false);
			await expect(describeSearchcastEngines(config)).rejects.toThrow(
				new RegExp(`unknown engine '${name}' \\(loaded recipes: none\\)`),
			);
		}
	});

	it('code recipes alone (env): no default engines merged in', async () => {
		const config = resolveConfig({
			cwd: project,
			globalPath,
			env: {WEBVEIL_SEARCHCAST_CODE_RECIPES: MWMBL_RECIPE},
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
		).toEqual(['mwmbl', 'marginalia']);
	});
});

describe('no trust rule relaxed', () => {
	it('a project webveil.json still cannot add code recipes, the bundled files included', async () => {
		for (const codeRecipes of [
			[MWMBL_RECIPE],
			[MARGINALIA_RECIPE],
			['./mine.mjs'],
		]) {
			writeJson(join(project, 'webveil.json'), {
				searchcast: {codeRecipes, engines: ['mwmbl']},
			});
			await expect(describeSearchcastEngines(fresh())).rejects.toThrow(
				TrustError,
			);
		}
	});

	it('a project webveil.json selecting the searchcast backend gets the bundled chain', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'searchcast'});
		expect(await describeSearchcastEngines(fresh())).toEqual(DEFAULT_CHAIN);
	});
});

// ---- the chain against local fakes of the Mwmbl and Marginalia APIs -------

let server: Server | undefined;
afterEach(async () => {
	if (server) await new Promise((r) => server!.close(r));
	server = undefined;
});

/**
 * Local fakes of the APIs on one server: Mwmbl's (`/mwmbl?q=<query>`,
 * results with `content`) and Marginalia's two, the URL-keyed one
 * (`/marginalia/<key>/search/<query>`) and the current one
 * (`/marginalia2/search?query=<query>`), both with results with `description`;
 * each answers 200 with results, or its given status. Returns the base URL and
 * the paths requested, in order.
 */
async function fakeApis(status: {mwmbl?: number; marginalia?: number} = {}) {
	const paths: string[] = [];
	server = createServer((req, res) => {
		const path = req.url ?? '';
		paths.push(path);
		const url = new URL(path, 'http://fake');
		const mwmbl = url.pathname === '/mwmbl';
		res.statusCode = (mwmbl ? status.mwmbl : status.marginalia) ?? 200;
		res.setHeader('content-type', 'application/json');
		if (mwmbl) {
			const query = url.searchParams.get('q');
			res.end(
				JSON.stringify({
					query,
					results: [
						{
							url: 'https://m.example/',
							title: `M about ${query}`,
							content: 'from mwmbl',
						},
						{title: 'no url'},
					],
				}),
			);
			return;
		}
		const query = path.startsWith('/marginalia2/')
			? url.searchParams.get('query')
			: decodeURIComponent(path.split('/')[4] ?? '');
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

/**
 * A transport that sends the APIs' requests to the local fakes instead. Each
 * request (its real URL and the options the recipe gave: kind, referer,
 * author headers) is recorded in `requests`, when given.
 */
function redirectTo(
	base: string,
	requests: {url: string; options: RequestOptions}[] = [],
): ChainTransport {
	const local = (url: string) => {
		if (url.startsWith(MWMBL_API))
			return `${base}/mwmbl${url.slice(MWMBL_API.length)}`;
		if (url.startsWith(`${MARGINALIA_API}/`))
			return `${base}/marginalia${url.slice(MARGINALIA_API.length)}`;
		if (url.startsWith(`${MARGINALIA_API2}/`))
			return `${base}/marginalia2${url.slice(MARGINALIA_API2.length)}`;
		throw new Error(`unexpected request ${url}`);
	};
	return {
		session(): TransportSession {
			return {
				async request(url: string, options: RequestOptions) {
					requests.push({url, options});
					const r = await globalThis.fetch(local(url));
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

const MARGINALIA_RESULTS = [
	{
		title: 'One about hello world',
		url: 'https://one.example/',
		snippet: 'the first',
	},
	{title: 'https://two.example/', url: 'https://two.example/'},
];

describe('a search through the default chain (local fake APIs, no network)', () => {
	it('asks Mwmbl first, keyless, strict and direct; Marginalia is not asked', async () => {
		const api = await fakeApis();
		const built: SearchcastOptions[] = [];
		const results = await searchFresh(redirectTo(api.base), built);
		expect(results).toEqual([
			{
				title: 'M about hello world',
				url: 'https://m.example/',
				snippet: 'from mwmbl',
			},
		]);
		expect(api.paths).toEqual(['/mwmbl?q=hello%20world']);
		expect(built[0]).toMatchObject({strict: true, proxy: undefined});
	});

	it('uses MWMBL_API_KEY when set', async () => {
		process.env.MWMBL_API_KEY = 'my key';
		const api = await fakeApis();
		await searchFresh(redirectTo(api.base));
		expect(api.paths).toEqual(['/mwmbl?q=hello%20world&api_key=my%20key']);
	});

	for (const status of [429, 503, 500]) {
		it(`falls through to Marginalia (shared public key) when Mwmbl answers ${status}`, async () => {
			const api = await fakeApis({mwmbl: status});
			const results = await searchFresh(redirectTo(api.base));
			// A fallback answer names the engine that failed first.
			expect(results).toEqual(
				MARGINALIA_RESULTS.map((r) => ({...r, unresponsiveEngines: ['mwmbl']})),
			);
			expect(api.paths).toEqual([
				'/mwmbl?q=hello%20world',
				'/marginalia/public/search/hello%20world',
			]);
		});
	}

	it('without MARGINALIA_API_KEY, Marginalia is the URL-keyed API, a document request with no author headers', async () => {
		const api = await fakeApis({mwmbl: 429});
		const requests: {url: string; options: RequestOptions}[] = [];
		await searchFresh(redirectTo(api.base, requests));
		expect(requests.at(-1)?.url).toBe(
			`${MARGINALIA_API}/public/search/hello%20world`,
		);
		expect(requests.at(-1)?.options.kind).toBe('document');
		expect(requests.at(-1)?.options.headers).toBeUndefined();
	});

	it('with MARGINALIA_API_KEY, Marginalia is the current API with the key in an API-Key header, never in the URL', async () => {
		process.env.MARGINALIA_API_KEY = 'my key';
		const api = await fakeApis({mwmbl: 429});
		const requests: {url: string; options: RequestOptions}[] = [];
		const results = await searchFresh(redirectTo(api.base, requests));
		expect(results).toEqual(
			MARGINALIA_RESULTS.map((r) => ({...r, unresponsiveEngines: ['mwmbl']})),
		);
		expect(api.paths.at(-1)).toBe('/marginalia2/search?query=hello%20world');
		expect(requests.at(-1)).toEqual({
			url: `${MARGINALIA_API2}/search?query=hello%20world`,
			options: expect.objectContaining({
				kind: 'fetch',
				referer: `${MARGINALIA_API2}/`,
				headers: {'api-key': 'my key'},
			}),
		});
		expect(requests.at(-1)?.url).not.toContain('my');
	});

	it('a failed search names both engines, and says the default changed and how to restore SearXNG', async () => {
		const api = await fakeApis({mwmbl: 503, marginalia: 503});
		const error = await searchFresh(redirectTo(api.base)).catch(
			(e: Error) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/every engine failed: mwmbl/);
		expect((error as Error).message).toMatch(/marginalia/);
		expect((error as Error).message).toContain(DEFAULT_BACKEND_NOTE);
		expect(DEFAULT_BACKEND_NOTE).toContain('"backend": "searxng"');
	});

	it('an explicitly chosen backend gets no such note', async () => {
		writeJson(globalPath, {backend: 'searchcast'});
		const api = await fakeApis({mwmbl: 503, marginalia: 503});
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
		expect(result.engines).toEqual(DEFAULT_CHAIN);
	});

	it('has no notice once the backend is set', async () => {
		writeJson(globalPath, {backend: 'searxng'});
		const result = await doctor(
			{},
			{loadInstall: async () => realInstall, resolveConfig: fresh},
		);
		expect(result).not.toHaveProperty('defaultBackend');
		expect(result).not.toHaveProperty('defaultChain');
	});
});

describe('webveil doctor with the default chain', () => {
	const run = () =>
		doctor({}, {loadInstall: async () => realInstall, resolveConfig: fresh});

	it('adds the defaultChain notice pointing to recipes (not a problem)', async () => {
		const result = await run();
		expect(result.defaultChain).toBe(DEFAULT_CHAIN_NOTE);
		expect(DEFAULT_CHAIN_NOTE).toContain('webveil install-recipes');
		expect(DEFAULT_CHAIN_NOTE).toMatch(/recipes/);
		expect(result.problems.join(' ')).not.toContain('default engine chain');
	});

	it('keeps it with an explicit searchcast backend and no chain of its own', async () => {
		writeJson(globalPath, {backend: 'searchcast'});
		const result = await run();
		expect(result).not.toHaveProperty('defaultBackend');
		expect(result.defaultChain).toBe(DEFAULT_CHAIN_NOTE);
	});

	it('drops it once the user configures a chain', async () => {
		writeJson(globalPath, {
			searchcast: {recipes: [writeAlpha()], engines: ['alpha']},
		});
		expect(await run()).not.toHaveProperty('defaultChain');
	});
});

// ---- the published tarball ------------------------------------------------

describe('the webveil tarball', () => {
	it('ships both bundled recipes', () => {
		const res = spawnSync(
			'npm',
			['pack', '--dry-run', '--json', '--ignore-scripts'],
			{cwd: pkgDir, encoding: 'utf8', timeout: 60_000},
		);
		expect(res.status).toBe(0);
		const [pack] = JSON.parse(res.stdout) as [{files: {path: string}[]}];
		const files = pack.files.map((f) => f.path);
		expect(files).toContain('recipes/mwmbl.mjs');
		expect(files).toContain('recipes/marginalia.mjs');
	});
});
