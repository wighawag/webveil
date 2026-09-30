// Every tuning value as config (task webveil-installs-and-tunables): each key
// is read from the global file, the project file and env; a bad value fails
// loud naming the key; unset, the old default holds; set, it reaches the
// place it governs (createSerpcast, an endpoint engine, the state store, the
// serpcast fetch transport and its pool, the redirect guard, the http helper,
// the search cut). No network: fakes stand in for serpcast and the backends.

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
	closeSerpcastInstances,
	createSerpcastBackend,
	serpcastIdentityKey,
} from '../src/core/backends/serpcast.js';
import {getBackend} from '../src/core/backends/registry.js';
import type {SearchResult} from '../src/core/backends/types.js';
import {search} from '../src/core/search.js';
import {fetch} from '../src/core/fetch.js';
import {
	closeFetchTransports,
	createSerpcastFetch,
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
	await closeSerpcastInstances();
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
		'fetchSerpcast.maxIdleSessions',
		1,
		'WEBVEIL_FETCH_SERPCAST_MAX_IDLE_SESSIONS',
		'1',
	],
	[
		'fetchSerpcast.sessionIdleMs',
		5000,
		'WEBVEIL_FETCH_SERPCAST_SESSION_IDLE_MS',
		'5000',
	],
	[
		'fetchSerpcast.reuseConnections',
		false,
		'WEBVEIL_FETCH_SERPCAST_REUSE_CONNECTIONS',
		'false',
	],
	[
		'fetchSerpcast.timeoutMs',
		4000,
		'WEBVEIL_FETCH_SERPCAST_TIMEOUT_MS',
		'4000',
	],
	[
		'fetchSerpcast.maxBodyBytes',
		2048,
		'WEBVEIL_FETCH_SERPCAST_MAX_BODY_BYTES',
		'2048',
	],
	['serpcast.timeoutMs', 4000, 'WEBVEIL_SERPCAST_TIMEOUT_MS', '4000'],
	['serpcast.maxBodyBytes', 2048, 'WEBVEIL_SERPCAST_MAX_BODY_BYTES', '2048'],
	[
		'serpcast.reuseConnections',
		false,
		'WEBVEIL_SERPCAST_REUSE_CONNECTIONS',
		'false',
	],
	['serpcast.keepSessions', false, 'WEBVEIL_SERPCAST_KEEP_SESSIONS', 'false'],
	['serpcast.idlePollMs', 2, 'WEBVEIL_SERPCAST_IDLE_POLL_MS', '2'],
	[
		'serpcast.maxRequestBodyBytes',
		4096,
		'WEBVEIL_SERPCAST_MAX_REQUEST_BODY_BYTES',
		'4096',
	],
	[
		'serpcast.preflightCache',
		false,
		'WEBVEIL_SERPCAST_PREFLIGHT_CACHE',
		'false',
	],
	[
		'serpcast.maxPreflightAgeS',
		60,
		'WEBVEIL_SERPCAST_MAX_PREFLIGHT_AGE_S',
		'60',
	],
	['serpcast.maxRedirects', 3, 'WEBVEIL_SERPCAST_MAX_REDIRECTS', '3'],
	['serpcast.sessionIdleMs', 1000, 'WEBVEIL_SERPCAST_SESSION_IDLE_MS', '1000'],
	['serpcast.cooldownMs', 0, 'WEBVEIL_SERPCAST_COOLDOWN_MS', '0'],
	['serpcast.decoyRule.top', 4, 'WEBVEIL_SERPCAST_DECOY_RULE_TOP', '4'],
	[
		'serpcast.decoyRule.maxRelevant',
		2,
		'WEBVEIL_SERPCAST_DECOY_RULE_MAX_RELEVANT',
		'2',
	],
	['serpcast.decoyRule.prefix', 4, 'WEBVEIL_SERPCAST_DECOY_RULE_PREFIX', '4'],
	[
		'serpcast.searchcast.timeoutMs',
		9000,
		'WEBVEIL_SERPCAST_SEARCHCAST_TIMEOUT_MS',
		'9000',
	],
	[
		'serpcast.searchcast.maxBodyBytes',
		2048,
		'WEBVEIL_SERPCAST_SEARCHCAST_MAX_BODY_BYTES',
		'2048',
	],
	['serpcast.state.persist', false, 'WEBVEIL_SERPCAST_STATE_PERSIST', 'false'],
	[
		'serpcast.state.lockStaleMs',
		500,
		'WEBVEIL_SERPCAST_STATE_LOCK_STALE_MS',
		'500',
	],
	[
		'serpcast.state.lockWaitMs',
		800,
		'WEBVEIL_SERPCAST_STATE_LOCK_WAIT_MS',
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
		writeJson(join(project, 'webveil.json'), serpcastProject({}));
		await expect(
			searchWith(fakeFactory().create, {WEBVEIL_SERPCAST_KEEP_SESSIONS: 'yes'}),
		).rejects.toThrow(
			/serpcast\.keepSessions must be true or false \(got 'yes'\)/,
		);
		await expect(
			searchWith(fakeFactory().create, {WEBVEIL_MAX_RESULTS: 'ten'}),
		).rejects.toThrow(/maxResults must be a positive integer/);
	});
});

describe('serpcast.decoyGuard: list or {include, exclude}, replaced whole', () => {
	const resolve = (env: Record<string, string> = {}) =>
		resolveConfig({cwd: project, globalPath, env});

	it('a project object replaces a global list whole (no mix of the two)', () => {
		writeJson(globalPath, {serpcast: {decoyGuard: ['bing']}});
		writeJson(join(project, 'webveil.json'), {
			serpcast: {decoyGuard: {exclude: ['alpha']}},
		});
		expect(resolve().serpcast!.decoyGuard).toEqual({exclude: ['alpha']});
	});

	it('env: WEBVEIL_SERPCAST_DECOY_GUARD_EXCLUDE gives the object form', () => {
		expect(
			resolve({
				WEBVEIL_SERPCAST_DECOY_GUARD: 'bing',
				WEBVEIL_SERPCAST_DECOY_GUARD_EXCLUDE: 'alpha, beta',
			}).serpcast!.decoyGuard,
		).toEqual({include: ['bing'], exclude: ['alpha', 'beta']});
		expect(
			resolve({WEBVEIL_SERPCAST_DECOY_GUARD_EXCLUDE: 'alpha'}).serpcast!
				.decoyGuard,
		).toEqual({exclude: ['alpha']});
		expect(
			resolve({WEBVEIL_SERPCAST_DECOY_GUARD: 'bing'}).serpcast!.decoyGuard,
		).toEqual(['bing']);
	});
});

// ---- 2. validation, at the place each key is used -------------------------

/** A createSerpcast recording its options; answers one hit per search. */
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

function serpcastProject(extra: Record<string, unknown>) {
	return {
		backend: 'serpcast',
		...extra,
		serpcast: {
			engines: ['alpha'],
			recipes: ['recipes'],
			...(extra.serpcast as object),
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
				name === 'serpcast'
					? createSerpcastBackend(config, {createSerpcast: create})
					: getBackend(name, config),
		},
	);
}

const BAD_SEARCH: [string, unknown, RegExp][] = [
	['maxResults', 0, /maxResults must be a positive integer/],
	['httpTimeoutMs', -1, /httpTimeoutMs must be a positive integer/],
	['serpcast.timeoutMs', 1.5, /serpcast\.timeoutMs must be a positive integer/],
	['serpcast.maxBodyBytes', 0, /serpcast\.maxBodyBytes/],
	[
		'serpcast.reuseConnections',
		'no',
		/serpcast\.reuseConnections must be true or false/,
	],
	['serpcast.keepSessions', 1, /serpcast\.keepSessions/],
	['serpcast.idlePollMs', 0, /serpcast\.idlePollMs must be a positive number/],
	['serpcast.maxRequestBodyBytes', -5, /serpcast\.maxRequestBodyBytes/],
	['serpcast.preflightCache', 'yes', /serpcast\.preflightCache/],
	['serpcast.maxPreflightAgeS', 0, /serpcast\.maxPreflightAgeS/],
	[
		'serpcast.maxRedirects',
		-1,
		/serpcast\.maxRedirects must be an integer >= 0/,
	],
	[
		'serpcast.sessionIdleMs',
		0,
		/serpcast\.sessionIdleMs must be a positive number/,
	],
	['serpcast.cooldownMs', -1, /serpcast\.cooldownMs must be a number >= 0/],
	['serpcast.decoyRule', 5, /serpcast\.decoyRule must be an object/],
	['serpcast.decoyRule.top', 0, /serpcast\.decoyRule\.top/],
	['serpcast.decoyRule.maxRelevant', 1.5, /serpcast\.decoyRule\.maxRelevant/],
	['serpcast.decoyRule.prefix', 'x', /serpcast\.decoyRule\.prefix/],
	[
		'serpcast.decoyRule.other',
		1,
		/serpcast\.decoyRule\.other is not a decoy rule key/,
	],
	['serpcast.decoyGuard', {include: 'bing'}, /serpcast\.decoyGuard must be/],
	['serpcast.decoyGuard', {only: ['bing']}, /serpcast\.decoyGuard must be/],
	['serpcast.searchcast.timeoutMs', 0, /serpcast\.searchcast\.timeoutMs/],
	[
		'serpcast.searchcast.maxBodyBytes',
		-1,
		/serpcast\.searchcast\.maxBodyBytes/,
	],
	['serpcast.state', true, /serpcast\.state must be an object/],
	[
		'serpcast.state.persist',
		'off',
		/serpcast\.state\.persist must be true or false/,
	],
	['serpcast.state.lockStaleMs', 0, /serpcast\.state\.lockStaleMs/],
	['serpcast.state.lockWaitMs', 1.5, /serpcast\.state\.lockWaitMs/],
];

describe('a bad value fails loud, naming the key (search)', () => {
	for (const [path, value, error] of BAD_SEARCH)
		it(`${path} = ${JSON.stringify(value)}`, async () => {
			const fake = fakeFactory();
			const [top, ...rest] = path.split('.');
			const extra =
				top === 'serpcast'
					? {serpcast: nested(rest.join('.'), value)}
					: nested(path, value);
			writeJson(join(project, 'webveil.json'), serpcastProject(extra));
			await expect(searchWith(fake.create)).rejects.toThrow(error);
			expect(fake.built).toHaveLength(0); // before any instance
		});
});

// ---- 3. unset: the old default; set: it takes effect ----------------------

describe('serpcast pass-throughs reach createSerpcast', () => {
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

	it('unset: none is passed, so serpcast keeps its defaults', async () => {
		writeJson(join(project, 'webveil.json'), serpcastProject({}));
		const fake = fakeFactory();
		await searchWith(fake.create);
		for (const key of Object.keys(SET))
			expect(fake.built[0]).not.toHaveProperty(key);
	});

	it('set: each is handed over as is', async () => {
		writeJson(join(project, 'webveil.json'), serpcastProject({serpcast: SET}));
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]).toMatchObject(SET);
	});

	it('the endpoint limits go on each endpoint engine, only when set', async () => {
		const endpoint = {mode: 'endpoint', endpoint: 'http://127.0.0.1:1'};
		const engines = ['alpha', 'searchcast:web'];
		writeJson(
			join(project, 'webveil.json'),
			serpcastProject({serpcast: {engines, searchcast: endpoint}}),
		);
		let fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.chains[0]![1]).toEqual({
			name: 'searchcast:web',
			searchcast: {endpoint: 'http://127.0.0.1:1', recipe: 'web'},
		});
		await closeSerpcastInstances();
		writeJson(
			join(project, 'webveil.json'),
			serpcastProject({
				serpcast: {
					engines,
					searchcast: {...endpoint, timeoutMs: 9000, maxBodyBytes: 2048},
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
		const key = (serpcast: object) =>
			serpcastIdentityKey({
				backend: 'serpcast',
				baseUrl: 'http://127.0.0.1:8080',
				egress: {mode: 'direct'},
				fetchSize: 'm',
				serpcast: {engines: ['alpha'], ...serpcast},
			});
		const base = key({});
		expect(key({timeoutMs: undefined})).toBe(base);
		expect(key({timeoutMs: 4000})).not.toBe(base);
		expect(key({state: {lockWaitMs: 800}})).not.toBe(base);
	});
});

describe('serpcast.state: persistence and the lock times', () => {
	async function builtStore(state?: object) {
		writeJson(
			join(project, 'webveil.json'),
			serpcastProject({serpcast: state ? {state} : {}}),
		);
		const fake = fakeFactory();
		await searchWith(fake.create);
		const key = serpcastIdentityKey(
			resolveConfig({cwd: project, globalPath, env: {}}),
		);
		return {store: fake.built[0]!.store!, dir: partitionDir(key)};
	}

	it('persists on disk by default; persist: false keeps it in memory, nothing on disk', async () => {
		const disk = await builtStore();
		await disk.store.set('k', 1);
		expect(existsSync(join(disk.dir, 'state.json'))).toBe(true);
		await closeSerpcastInstances();
		const memory = await builtStore({persist: false});
		await memory.store.set('k', 1);
		expect(await memory.store.get('k')).toBe(1);
		expect(existsSync(memory.dir)).toBe(false);
	});

	it('persist: false with a persistent browser profile is an error', async () => {
		writeJson(
			join(project, 'webveil.json'),
			serpcastProject({
				serpcast: {state: {persist: false}, searchcast: {persistProfile: true}},
			}),
		);
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/persistProfile.*serpcast\.state\.persist is false/,
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
		writeJson(join(project, 'webveil.json'), serpcastProject({}));
		expect(await searchWith(fakeFactory().create)).toHaveLength(10);
		writeJson(join(project, 'webveil.json'), serpcastProject({maxResults: 3}));
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

// ---- the serpcast fetch transport and the redirect limit -------------------

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

describe('fetchSerpcast: the serpcast fetch transport and its pool', () => {
	it('unset: serpcast defaults (no limits passed), 4 idle sessions kept', async () => {
		const fake = fakeTransport();
		await createSerpcastFetch(cfg(), {createTransport: fake.create, ...noSsrf})(
			PAGE,
		);
		for (const key of ['timeoutMs', 'maxBodyBytes', 'reuseConnections'])
			expect(fake.built[0]).not.toHaveProperty(key);
		expect(fake.closed).toEqual([]); // kept idle
	});

	it('set: the limits reach the transport, maxIdleSessions 0 keeps none', async () => {
		const fake = fakeTransport();
		const fetchSerpcast = {
			timeoutMs: 4000,
			maxBodyBytes: 2048,
			reuseConnections: false,
			maxIdleSessions: 0,
		};
		await createSerpcastFetch(cfg({fetchSerpcast}), {
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
			const adapter = createSerpcastFetch(
				cfg({fetchSerpcast: {sessionIdleMs: 1000}}),
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
		await createSerpcastFetch(cfg(), deps)(PAGE);
		await createSerpcastFetch(
			cfg({fetchSerpcast: {timeoutMs: 4000}}),
			deps,
		)(PAGE);
		expect(fake.built).toHaveLength(2);
	});

	it('a bad value fails loud before any transport is built', () => {
		const fake = fakeTransport();
		for (const [fetchSerpcast, error] of [
			[{maxIdleSessions: -1}, /fetchSerpcast\.maxIdleSessions/],
			[{sessionIdleMs: 0}, /fetchSerpcast\.sessionIdleMs/],
			[{reuseConnections: 'no'}, /fetchSerpcast\.reuseConnections/],
			[{timeoutMs: 1.5}, /fetchSerpcast\.timeoutMs/],
			[{maxBodyBytes: 0}, /fetchSerpcast\.maxBodyBytes/],
		] as const)
			expect(() =>
				createSerpcastFetch(cfg({fetchSerpcast} as never), {
					createTransport: fake.create,
				}),
			).toThrow(error);
		expect(() =>
			createSerpcastFetch(cfg({fetchMaxRedirects: -1}), {
				createTransport: fake.create,
			}),
		).toThrow(/fetchMaxRedirects must be an integer >= 0/);
		expect(fake.built).toHaveLength(0);
	});
});

describe('fetchMaxRedirects: both transports', () => {
	it('serpcast transport: 20 by default, the configured limit when set', async () => {
		const fake = fakeTransport(true);
		const deps = {createTransport: fake.create, ...noSsrf};
		await expect(createSerpcastFetch(cfg(), deps)(PAGE)).rejects.toThrow(
			/more than 20/,
		);
		expect(fake.requests).toHaveLength(21);
		fake.requests.length = 0;
		await expect(
			createSerpcastFetch(cfg({fetchMaxRedirects: 2}), deps)(PAGE),
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
		writeJson(join(project, 'webveil.json'), {fetchMaxRedirects: 0});
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
