// Every tuning value as config (task webveil-installs-and-tunables): each key
// is read from the global file, the project file and env; a bad value fails
// loud naming the key; unset, the old default holds; set, it reaches the
// place it governs (createSearchcast, an endpoint engine, the state store, the
// searchcast fetch transport and its pool, the redirect guard, the http helper,
// the search cut). No network: fakes stand in for searchcast and the backends.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import type {
	Engine,
	Searchcast,
	SearchcastOptions,
	Transport,
	TransportOptions,
} from 'searchcast';
import {resolveConfig} from '../src/core/config.js';
import type {Config} from '../src/core/config.js';
import {
	closeSearchcastInstances,
	createSearchcastBackend,
	searchcastIdentityKey,
} from '../src/core/backends/searchcast.js';
import {getBackend} from '../src/core/backends/registry.js';
import type {SearchResult} from '../src/core/backends/types.js';
import {search} from '../src/core/search.js';
import {fetch} from '../src/core/fetch.js';
import {
	closeFetchTransports,
	createSearchcastFetch,
} from '../src/core/fetch-transport.js';
import {createHttp} from '../src/core/http.js';
import {guardEgressFetch} from '../src/core/security.js';
import type {EgressFetch} from '../src/core/egress.js';
import {createStateStore, partitionDir} from '../src/core/state.js';

const realGlobal = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
	'webveil',
	'config.json',
);
let realGlobalExisted: boolean;
let root: string;
let globalPath: string;
let project: string;

beforeEach(() => {
	realGlobalExisted = existsSync(realGlobal);
	root = mkdtempSync(join(tmpdir(), 'webveil-tunables-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	writeJson(join(project, 'recipes', 'alpha.json'), {
		navigate: {url: 'https://alpha.test/?q={query}'},
		ready: '.r',
		results: {item: '.r', fields: {title: {}, url: {attr: 'href'}}},
	});
});

afterEach(async () => {
	await closeSearchcastInstances();
	await closeFetchTransports();
	rmSync(root, {recursive: true, force: true});
	expect(existsSync(realGlobal)).toBe(realGlobalExisted);
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

/** `{a: {b: value}}` from `a.b`. */
function nested(path: string, value: unknown): Record<string, unknown> {
	return path
		.split('.')
		.reduceRight<unknown>((inner, key) => ({[key]: inner}), value) as Record<
		string,
		unknown
	>;
}

function at(config: object, path: string): unknown {
	return path
		.split('.')
		.reduce<unknown>(
			(o, k) => (o as Record<string, unknown> | undefined)?.[k],
			config,
		);
}

// ---- 1. every key, from every layer --------------------------------------

/** [key path, a valid value, its env variable, that value as env text]. */
const KEYS: [string, unknown, string, string][] = [
	['maxResults', 3, 'WEBVEIL_MAX_RESULTS', '3'],
	['httpTimeoutMs', 1234, 'WEBVEIL_HTTP_TIMEOUT_MS', '1234'],
	['fetchMaxRedirects', 2, 'WEBVEIL_FETCH_MAX_REDIRECTS', '2'],
	[
		'fetchSearchcast.maxIdleSessions',
		1,
		'WEBVEIL_FETCH_SEARCHCAST_MAX_IDLE_SESSIONS',
		'1',
	],
	[
		'fetchSearchcast.sessionIdleMs',
		5000,
		'WEBVEIL_FETCH_SEARCHCAST_SESSION_IDLE_MS',
		'5000',
	],
	[
		'fetchSearchcast.reuseConnections',
		false,
		'WEBVEIL_FETCH_SEARCHCAST_REUSE_CONNECTIONS',
		'false',
	],
	[
		'fetchSearchcast.timeoutMs',
		4000,
		'WEBVEIL_FETCH_SEARCHCAST_TIMEOUT_MS',
		'4000',
	],
	[
		'fetchSearchcast.maxBodyBytes',
		2048,
		'WEBVEIL_FETCH_SEARCHCAST_MAX_BODY_BYTES',
		'2048',
	],
	['searchcast.timeoutMs', 4000, 'WEBVEIL_SEARCHCAST_TIMEOUT_MS', '4000'],
	[
		'searchcast.maxBodyBytes',
		2048,
		'WEBVEIL_SEARCHCAST_MAX_BODY_BYTES',
		'2048',
	],
	[
		'searchcast.reuseConnections',
		false,
		'WEBVEIL_SEARCHCAST_REUSE_CONNECTIONS',
		'false',
	],
	[
		'searchcast.keepSessions',
		false,
		'WEBVEIL_SEARCHCAST_KEEP_SESSIONS',
		'false',
	],
	['searchcast.idlePollMs', 2, 'WEBVEIL_SEARCHCAST_IDLE_POLL_MS', '2'],
	[
		'searchcast.maxRequestBodyBytes',
		4096,
		'WEBVEIL_SEARCHCAST_MAX_REQUEST_BODY_BYTES',
		'4096',
	],
	[
		'searchcast.preflightCache',
		false,
		'WEBVEIL_SEARCHCAST_PREFLIGHT_CACHE',
		'false',
	],
	[
		'searchcast.maxPreflightAgeS',
		60,
		'WEBVEIL_SEARCHCAST_MAX_PREFLIGHT_AGE_S',
		'60',
	],
	['searchcast.maxRedirects', 3, 'WEBVEIL_SEARCHCAST_MAX_REDIRECTS', '3'],
	[
		'searchcast.sessionIdleMs',
		1000,
		'WEBVEIL_SEARCHCAST_SESSION_IDLE_MS',
		'1000',
	],
	['searchcast.cooldownMs', 0, 'WEBVEIL_SEARCHCAST_COOLDOWN_MS', '0'],
	['searchcast.decoyRule.top', 4, 'WEBVEIL_SEARCHCAST_DECOY_RULE_TOP', '4'],
	[
		'searchcast.decoyRule.maxRelevant',
		2,
		'WEBVEIL_SEARCHCAST_DECOY_RULE_MAX_RELEVANT',
		'2',
	],
	[
		'searchcast.decoyRule.prefix',
		4,
		'WEBVEIL_SEARCHCAST_DECOY_RULE_PREFIX',
		'4',
	],
	[
		'searchcast.browser.timeoutMs',
		9000,
		'WEBVEIL_SEARCHCAST_BROWSER_TIMEOUT_MS',
		'9000',
	],
	[
		'searchcast.browser.maxBodyBytes',
		2048,
		'WEBVEIL_SEARCHCAST_BROWSER_MAX_BODY_BYTES',
		'2048',
	],
	[
		'searchcast.state.persist',
		false,
		'WEBVEIL_SEARCHCAST_STATE_PERSIST',
		'false',
	],
	[
		'searchcast.state.lockStaleMs',
		500,
		'WEBVEIL_SEARCHCAST_STATE_LOCK_STALE_MS',
		'500',
	],
	[
		'searchcast.state.lockWaitMs',
		800,
		'WEBVEIL_SEARCHCAST_STATE_LOCK_WAIT_MS',
		'800',
	],
];

describe('every tuning key is read from global, project and env', () => {
	for (const [path, value, envName, envText] of KEYS)
		it(path, () => {
			const resolve = (env: Record<string, string> = {}) =>
				resolveConfig({cwd: project, globalPath, env});
			expect(at(resolve(), path)).toBeUndefined(); // unset by default
			writeJson(globalPath, nested(path, value));
			expect(at(resolve(), path)).toEqual(value);
			rmSync(globalPath);
			writeJson(join(project, 'webveil.json'), nested(path, value));
			expect(at(resolve(), path)).toEqual(value);
			rmSync(join(project, 'webveil.json'));
			expect(at(resolve({[envName]: envText}), path)).toEqual(value);
		});

	it('an env switch other than true/false and an env number that is not one fail loud', async () => {
		writeJson(join(project, 'webveil.json'), searchcastProject({}));
		await expect(
			searchWith(fakeFactory().create, {
				WEBVEIL_SEARCHCAST_KEEP_SESSIONS: 'yes',
			}),
		).rejects.toThrow(
			/searchcast\.keepSessions must be true or false \(got 'yes'\)/,
		);
		await expect(
			searchWith(fakeFactory().create, {WEBVEIL_MAX_RESULTS: 'ten'}),
		).rejects.toThrow(/maxResults must be a positive integer/);
	});
});

describe('searchcast.decoyGuard: list or {include, exclude}, replaced whole', () => {
	const resolve = (env: Record<string, string> = {}) =>
		resolveConfig({cwd: project, globalPath, env});

	it('a project object replaces a global list whole (no mix of the two)', () => {
		writeJson(globalPath, {searchcast: {decoyGuard: ['engine-a']}});
		writeJson(join(project, 'webveil.json'), {
			searchcast: {decoyGuard: {exclude: ['alpha']}},
		});
		expect(resolve().searchcast!.decoyGuard).toEqual({exclude: ['alpha']});
	});

	it('env: WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE gives the object form', () => {
		expect(
			resolve({
				WEBVEIL_SEARCHCAST_DECOY_GUARD: 'engine-a',
				WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE: 'alpha, beta',
			}).searchcast!.decoyGuard,
		).toEqual({include: ['engine-a'], exclude: ['alpha', 'beta']});
		expect(
			resolve({WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE: 'alpha'}).searchcast!
				.decoyGuard,
		).toEqual({exclude: ['alpha']});
		expect(
			resolve({WEBVEIL_SEARCHCAST_DECOY_GUARD: 'engine-a'}).searchcast!
				.decoyGuard,
		).toEqual(['engine-a']);
	});
});

// ---- 2. validation, at the place each key is used -------------------------

/** A createSearchcast recording its options; answers one hit per search. */
function fakeFactory() {
	const built: SearchcastOptions[] = [];
	const chains: Engine[][] = [];
	const create = (options: SearchcastOptions): Searchcast => {
		built.push(options);
		return {
			async search(_query, {engines}) {
				chains.push([...engines]);
				const results = Array.from({length: 15}, (_, i) => ({
					title: `hit ${i}`,
					url: `https://alpha.example/${i}`,
				}));
				return {results, engine: 'alpha', failures: []};
			},
			clearSessions: async () => {},
			close: async () => {},
		};
	};
	return {create, built, chains};
}

function searchcastProject(extra: Record<string, unknown>) {
	return {
		backend: 'searchcast',
		...extra,
		searchcast: {
			engines: ['alpha'],
			recipes: ['recipes'],
			...(extra.searchcast as object),
		},
	};
}

function searchWith(
	create: (o: SearchcastOptions) => Searchcast,
	env: Record<string, string> = {},
	maxResults?: number,
) {
	return search(
		'q',
		{cwd: project, globalPath, env, maxResults},
		{
			getBackend: (name, config) =>
				name === 'searchcast'
					? createSearchcastBackend(config, {createSearchcast: create})
					: getBackend(name, config),
		},
	);
}

const BAD_SEARCH: [string, unknown, RegExp][] = [
	['maxResults', 0, /maxResults must be a positive integer/],
	['httpTimeoutMs', -1, /httpTimeoutMs must be a positive integer/],
	[
		'searchcast.timeoutMs',
		1.5,
		/searchcast\.timeoutMs must be a positive integer/,
	],
	['searchcast.maxBodyBytes', 0, /searchcast\.maxBodyBytes/],
	[
		'searchcast.reuseConnections',
		'no',
		/searchcast\.reuseConnections must be true or false/,
	],
	['searchcast.keepSessions', 1, /searchcast\.keepSessions/],
	[
		'searchcast.idlePollMs',
		0,
		/searchcast\.idlePollMs must be a positive number/,
	],
	['searchcast.maxRequestBodyBytes', -5, /searchcast\.maxRequestBodyBytes/],
	['searchcast.preflightCache', 'yes', /searchcast\.preflightCache/],
	['searchcast.maxPreflightAgeS', 0, /searchcast\.maxPreflightAgeS/],
	[
		'searchcast.maxRedirects',
		-1,
		/searchcast\.maxRedirects must be an integer >= 0/,
	],
	[
		'searchcast.sessionIdleMs',
		0,
		/searchcast\.sessionIdleMs must be a positive number/,
	],
	['searchcast.cooldownMs', -1, /searchcast\.cooldownMs must be a number >= 0/],
	['searchcast.decoyRule', 5, /searchcast\.decoyRule must be an object/],
	['searchcast.decoyRule.top', 0, /searchcast\.decoyRule\.top/],
	[
		'searchcast.decoyRule.maxRelevant',
		1.5,
		/searchcast\.decoyRule\.maxRelevant/,
	],
	['searchcast.decoyRule.prefix', 'x', /searchcast\.decoyRule\.prefix/],
	[
		'searchcast.decoyRule.other',
		1,
		/searchcast\.decoyRule\.other is not a decoy rule key/,
	],
	[
		'searchcast.decoyGuard',
		{include: 'engine-a'},
		/searchcast\.decoyGuard must be/,
	],
	[
		'searchcast.decoyGuard',
		{only: ['engine-a']},
		/searchcast\.decoyGuard must be/,
	],
	['searchcast.browser.timeoutMs', 0, /searchcast\.browser\.timeoutMs/],
	['searchcast.browser.maxBodyBytes', -1, /searchcast\.browser\.maxBodyBytes/],
	['searchcast.state', true, /searchcast\.state must be an object/],
	[
		'searchcast.state.persist',
		'off',
		/searchcast\.state\.persist must be true or false/,
	],
	['searchcast.state.lockStaleMs', 0, /searchcast\.state\.lockStaleMs/],
	['searchcast.state.lockWaitMs', 1.5, /searchcast\.state\.lockWaitMs/],
];

describe('a bad value fails loud, naming the key (search)', () => {
	for (const [path, value, error] of BAD_SEARCH)
		it(`${path} = ${JSON.stringify(value)}`, async () => {
			const fake = fakeFactory();
			const [top, ...rest] = path.split('.');
			const extra =
				top === 'searchcast'
					? {searchcast: nested(rest.join('.'), value)}
					: nested(path, value);
			writeJson(join(project, 'webveil.json'), searchcastProject(extra));
			await expect(searchWith(fake.create)).rejects.toThrow(error);
			expect(fake.built).toHaveLength(0); // before any instance
		});
});

// ---- 3. unset: the old default; set: it takes effect ----------------------

describe('searchcast pass-throughs reach createSearchcast', () => {
	const SET = {
		timeoutMs: 4000,
		maxBodyBytes: 2048,
		reuseConnections: false,
		keepSessions: false,
		idlePollMs: 2,
		maxRequestBodyBytes: 4096,
		preflightCache: false,
		maxPreflightAgeS: 60,
		maxRedirects: 3,
		decoyRule: {top: 4, maxRelevant: 2},
		decoyGuard: {include: ['alpha'], exclude: ['beta']},
	};

	it('unset: none is passed, so searchcast keeps its defaults', async () => {
		writeJson(join(project, 'webveil.json'), searchcastProject({}));
		const fake = fakeFactory();
		await searchWith(fake.create);
		for (const key of Object.keys(SET))
			expect(fake.built[0]).not.toHaveProperty(key);
	});

	it('set: each is handed over as is', async () => {
		writeJson(
			join(project, 'webveil.json'),
			searchcastProject({searchcast: SET}),
		);
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]).toMatchObject(SET);
	});

	it('the endpoint limits go on each endpoint engine, only when set', async () => {
		const endpoint = {mode: 'endpoint', endpoint: 'http://127.0.0.1:1'};
		const engines = ['alpha', 'searchcast:web'];
		writeJson(
			join(project, 'webveil.json'),
			searchcastProject({searchcast: {engines, browser: endpoint}}),
		);
		let fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.chains[0]![1]).toEqual({
			name: 'searchcast:web',
			searchcast: {endpoint: 'http://127.0.0.1:1', recipe: 'web'},
		});
		await closeSearchcastInstances();
		writeJson(
			join(project, 'webveil.json'),
			searchcastProject({
				searchcast: {
					engines,
					browser: {...endpoint, timeoutMs: 9000, maxBodyBytes: 2048},
				},
			}),
		);
		fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.chains[0]![1]).toMatchObject({
			searchcast: {timeoutMs: 9000, maxBodyBytes: 2048},
		});
	});

	it('every set key joins the identity key; unset keys leave it unchanged', () => {
		const key = (searchcast: object) =>
			searchcastIdentityKey({
				backend: 'searchcast',
				baseUrl: 'http://127.0.0.1:8080',
				egress: {mode: 'direct'},
				fetchSize: 'm',
				searchcast: {engines: ['alpha'], ...searchcast},
			});
		const base = key({});
		expect(key({timeoutMs: undefined})).toBe(base);
		expect(key({timeoutMs: 4000})).not.toBe(base);
		expect(key({state: {lockWaitMs: 800}})).not.toBe(base);
	});
});

describe('searchcast.state: persistence and the lock times', () => {
	async function builtStore(state?: object) {
		writeJson(
			join(project, 'webveil.json'),
			searchcastProject({searchcast: state ? {state} : {}}),
		);
		const fake = fakeFactory();
		await searchWith(fake.create);
		const key = searchcastIdentityKey(
			resolveConfig({cwd: project, globalPath, env: {}}),
		);
		return {store: fake.built[0]!.store!, dir: partitionDir(key)};
	}

	it('persists on disk by default; persist: false keeps it in memory, nothing on disk', async () => {
		const disk = await builtStore();
		await disk.store.set('k', 1);
		expect(existsSync(join(disk.dir, 'state.json'))).toBe(true);
		await closeSearchcastInstances();
		const memory = await builtStore({persist: false});
		await memory.store.set('k', 1);
		expect(await memory.store.get('k')).toBe(1);
		expect(existsSync(memory.dir)).toBe(false);
	});

	it('persist: false with a persistent browser profile is an error', async () => {
		writeJson(
			join(project, 'webveil.json'),
			searchcastProject({
				searchcast: {state: {persist: false}, browser: {persistProfile: true}},
			}),
		);
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/persistProfile.*searchcast\.state\.persist is false/,
		);
	});

	/** Hold the partition's lock as another process would: a fresh token. */
	function holdLock(dir: string, ageMs = 0) {
		const token = join(dir, 'state.lock', 'other-holder');
		mkdirSync(dirname(token), {recursive: true});
		writeFileSync(token, '');
		const at = (Date.now() - ageMs) / 1000;
		utimesSync(token, at, at);
	}

	it('lockWaitMs bounds the wait for a held lock', async () => {
		const {store, dir} = await builtStore({lockWaitMs: 100});
		holdLock(dir);
		const start = Date.now();
		await expect(store.set('k', 1)).rejects.toThrow(/held too long/);
		expect(Date.now() - start).toBeLessThan(5_000); // not the 30 s default
	});

	it('lockStaleMs decides when a held lock counts as abandoned', async () => {
		const {store, dir} = await builtStore({lockStaleMs: 200, lockWaitMs: 5000});
		holdLock(dir, 1000); // older than 200 ms, younger than the 10 s default
		await store.set('k', 1);
		expect(await store.get('k')).toBe(1);
	});

	it('the defaults: a lock 1 s old is not stale (10 s), so a short wait gives up', async () => {
		const dir = partitionDir('d'.repeat(64));
		holdLock(dir, 1000);
		const store = createStateStore(dir, {lock: {waitMs: 100}});
		await expect(store.set('k', 1)).rejects.toThrow(/held too long/);
	});
});

describe('search: maxResults and httpTimeoutMs', () => {
	it('the default cut is 10, maxResults changes it, the call option still wins', async () => {
		writeJson(join(project, 'webveil.json'), searchcastProject({}));
		expect(await searchWith(fakeFactory().create)).toHaveLength(10);
		writeJson(
			join(project, 'webveil.json'),
			searchcastProject({maxResults: 3}),
		);
		expect(await searchWith(fakeFactory().create)).toHaveLength(3);
		expect(await searchWith(fakeFactory().create, {}, 5)).toHaveLength(5);
		expect(
			await searchWith(fakeFactory().create, {WEBVEIL_MAX_RESULTS: '2'}),
		).toHaveLength(2);
	});

	it('the http helper gets httpTimeoutMs (30 s unset)', async () => {
		const timeouts: (number | undefined)[] = [];
		const run = (config: Partial<Config>) =>
			search(
				'q',
				{},
				{
					resolveConfig: () => ({
						backend: 'searxng',
						baseUrl: 'https://search.example',
						egress: {mode: 'direct'},
						fetchSize: 'm',
						...config,
					}),
					createHttp: (_d, helper) => {
						timeouts.push(helper?.timeoutMs);
						return {fetchJson: vi.fn(), fetchText: vi.fn()} as never;
					},
					getBackend: () => ({
						search: async (): Promise<SearchResult[]> => [],
					}),
				},
			);
		await run({});
		await run({httpTimeoutMs: 1234});
		expect(timeouts).toEqual([30_000, 1234]);
	});

	it('the helper aborts a request past its timeout', async () => {
		const server = createServer(() => {}); // never answers
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		try {
			const {port} = server.address() as AddressInfo;
			const http = createHttp(undefined, {timeoutMs: 50});
			await expect(
				http.fetchText(`http://127.0.0.1:${port}/`),
			).rejects.toThrow();
		} finally {
			server.closeAllConnections();
			await new Promise((r) => server.close(r));
		}
	});
});

// ---- the searchcast fetch transport and the redirect limit -------------------

const PAGE = 'https://93.184.215.14/page';

function fakeTransport(redirects = false) {
	const built: TransportOptions[] = [];
	const closed: number[] = [];
	const requests: string[] = [];
	let sessions = 0;
	const create = (options: TransportOptions): Transport => {
		built.push(options);
		return {
			check: async () => ({
				path: '/fake',
				version: 'x',
				target: 'chrome146',
				impersonating: true,
			}),
			session() {
				const id = ++sessions;
				return {
					async request(url: string) {
						requests.push(url);
						const html = '<h1>page</h1>';
						return {
							url,
							status: redirects ? 302 : 200,
							headers: new Headers({
								'content-type': 'text/html',
								...(redirects && {location: `${url}x`}),
							}),
							body: new TextEncoder().encode(html),
							text: () => html,
						};
					},
					cookies: () => [],
					clearCookies() {},
					close() {
						closed.push(id);
					},
				} as never;
			},
		};
	};
	return {create, built, closed, requests};
}

function cfg(overrides: Partial<Config> = {}): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress: {mode: 'direct'},
		fetchSize: 'm',
		...overrides,
	};
}

const noSsrf = {assertPublicUrl: async () => {}};

describe('fetchSearchcast: the searchcast fetch transport and its pool', () => {
	it('unset: searchcast defaults (no limits passed), 4 idle sessions kept', async () => {
		const fake = fakeTransport();
		await createSearchcastFetch(cfg(), {
			createTransport: fake.create,
			...noSsrf,
		})(PAGE);
		for (const key of ['timeoutMs', 'maxBodyBytes', 'reuseConnections'])
			expect(fake.built[0]).not.toHaveProperty(key);
		expect(fake.closed).toEqual([]); // kept idle
	});

	it('set: the limits reach the transport, maxIdleSessions 0 keeps none', async () => {
		const fake = fakeTransport();
		const fetchSearchcast = {
			timeoutMs: 4000,
			maxBodyBytes: 2048,
			reuseConnections: false,
			maxIdleSessions: 0,
		};
		await createSearchcastFetch(cfg({fetchSearchcast}), {
			createTransport: fake.create,
			...noSsrf,
		})(PAGE);
		expect(fake.built[0]).toMatchObject({
			timeoutMs: 4000,
			maxBodyBytes: 2048,
			reuseConnections: false,
		});
		expect(fake.closed).toEqual([1]);
	});

	it('sessionIdleMs closes an idle session after that long', async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeTransport();
			const adapter = createSearchcastFetch(
				cfg({fetchSearchcast: {sessionIdleMs: 1000}}),
				{createTransport: fake.create, ...noSsrf},
			);
			await adapter(PAGE);
			vi.advanceTimersByTime(999);
			expect(fake.closed).toEqual([]);
			vi.advanceTimersByTime(1);
			expect(fake.closed).toEqual([1]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a folder with other values gets its own pool', async () => {
		const fake = fakeTransport();
		const deps = {createTransport: fake.create, ...noSsrf};
		await createSearchcastFetch(cfg(), deps)(PAGE);
		await createSearchcastFetch(
			cfg({fetchSearchcast: {timeoutMs: 4000}}),
			deps,
		)(PAGE);
		expect(fake.built).toHaveLength(2);
	});

	it('a bad value fails loud before any transport is built', () => {
		const fake = fakeTransport();
		for (const [fetchSearchcast, error] of [
			[{maxIdleSessions: -1}, /fetchSearchcast\.maxIdleSessions/],
			[{sessionIdleMs: 0}, /fetchSearchcast\.sessionIdleMs/],
			[{reuseConnections: 'no'}, /fetchSearchcast\.reuseConnections/],
			[{timeoutMs: 1.5}, /fetchSearchcast\.timeoutMs/],
			[{maxBodyBytes: 0}, /fetchSearchcast\.maxBodyBytes/],
		] as const)
			expect(() =>
				createSearchcastFetch(cfg({fetchSearchcast} as never), {
					createTransport: fake.create,
				}),
			).toThrow(error);
		expect(() =>
			createSearchcastFetch(cfg({fetchMaxRedirects: -1}), {
				createTransport: fake.create,
			}),
		).toThrow(/fetchMaxRedirects must be an integer >= 0/);
		expect(fake.built).toHaveLength(0);
	});
});

describe('fetchMaxRedirects: both transports', () => {
	it('searchcast transport: 20 by default, the configured limit when set', async () => {
		const fake = fakeTransport(true);
		const deps = {createTransport: fake.create, ...noSsrf};
		await expect(createSearchcastFetch(cfg(), deps)(PAGE)).rejects.toThrow(
			/more than 20/,
		);
		expect(fake.requests).toHaveLength(21);
		fake.requests.length = 0;
		await expect(
			createSearchcastFetch(cfg({fetchMaxRedirects: 2}), deps)(PAGE),
		).rejects.toThrow(/more than 2\b/);
		expect(fake.requests).toHaveLength(3);
	});

	const redirecting = () =>
		vi.fn(
			async (input: unknown) =>
				new Response(null, {
					status: 302,
					headers: {location: `${String(input)}x`},
				}),
		) as unknown as EgressFetch & {mock: {calls: unknown[]}};

	it('plain transport, direct egress: the guard stops at the configured limit', async () => {
		const inner = redirecting();
		const guarded = guardEgressFetch(
			inner,
			cfg({fetchMaxRedirects: 1}),
			noSsrf,
		);
		await expect(guarded(PAGE)).rejects.toThrow(/more than 1\b/);
		expect(inner.mock.calls).toHaveLength(2);
	});

	it('plain transport, proxy egress: delegated to undici unset, followed by the guard when set', async () => {
		const egress = {mode: 'socks5', url: 'socks5://127.0.0.1:9050'} as const;
		const unset = redirecting();
		const response = await guardEgressFetch(unset, cfg({egress}))(PAGE);
		expect(response.status).toBe(302); // undici's own following, untouched
		expect(unset.mock.calls).toHaveLength(1);
		const set = redirecting();
		await expect(
			guardEgressFetch(set, cfg({egress, fetchMaxRedirects: 2}))(PAGE),
		).rejects.toThrow(/more than 2\b/);
		expect(set.mock.calls).toHaveLength(3);
	});

	it('reaches the plain guard through the core fetch from config', async () => {
		writeJson(join(project, 'webveil.json'), {
			fetchMaxRedirects: 0,
			fetchTransport: 'plain',
		});
		const inner = redirecting();
		await expect(
			fetch(
				'https://93.184.215.14/',
				{cwd: project, globalPath, env: {}},
				{
					createEgressFetch: () => inner,
					getBackend: () => ({search: async () => []}),
				},
			),
		).rejects.toThrow(/more than 0\b/);
		expect(inner.mock.calls).toHaveLength(1);
	});
});
