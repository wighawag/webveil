// The searchcast backend, driven through the core search() with REAL searchcast
// (engine chain, cooldowns, declarative recipe runner) over a FAKE transport:
// no live engine traffic and no native library. Config comes from real files in
// a temp dir (project webveil.json + an isolated global config), so trust and
// path resolution are exercised as users hit them.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {delimiter, dirname, join} from 'node:path';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Cli as IncurCli, Mcp} from 'incur';
import {createSearchcast, SearchcastError} from 'searchcast';
import type {Searchcast, SearchcastOptions, TransportSession} from 'searchcast';
import {
	clearSearchcastState,
	closeSearchcastInstances,
	createSearchcastBackend,
	searchcastIdentityKey,
	searchcastProxy,
} from '../src/core/backends/searchcast.js';
import {backendNames, getBackend} from '../src/core/backends/registry.js';
import type {Config} from '../src/core/config.js';
import {resolveConfig} from '../src/core/config.js';
import {carryProvenance} from '../src/core/layers.js';
import {assertEgressAllowsBaseUrl, EgressError} from '../src/core/egress.js';
import {search} from '../src/core/search.js';
import {TrustError} from '../src/core/trust.js';
import {partitionDir, stateRoot} from '../src/core/state.js';
import {createCli} from '../src/cli.js';

const realGlobal = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
	'webveil',
	'config.json',
);
let realGlobalExisted: boolean;
let root: string;
let globalPath: string;
let project: string;
let cwd: string;

beforeEach(() => {
	realGlobalExisted = existsSync(realGlobal);
	root = mkdtempSync(join(tmpdir(), 'webveil-searchcast-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	cwd = join(project, 'sub', 'dir');
	mkdirSync(cwd, {recursive: true});
	writeRecipe(join(project, 'recipes', 'alpha.json'), 'alpha');
	writeRecipe(join(project, 'recipes', 'beta.json'), 'beta');
});

afterEach(async () => {
	await closeSearchcastInstances();
	rmSync(root, {recursive: true, force: true});
	expect(existsSync(realGlobal)).toBe(realGlobalExisted);
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

/** A declarative recipe for `https://<name>.test/?q={query}`. */
function writeRecipe(path: string, name: string): void {
	writeJson(path, {
		navigate: {url: `https://${name}.test/?q={query}`},
		ready: '.r',
		empty: '.none',
		results: {
			item: '.r',
			fields: {
				title: {selector: 'a'},
				url: {selector: 'a', attr: 'href'},
				content: {selector: 'p'},
			},
		},
	});
}

/**
 * Host -> HTTP status the fake transport answers (200 renders one hit), or
 * `empty`, or `decoy` (five hits unrelated to any query, the page an engine
 * that serves decoys answers).
 */
type Behaviour = Record<string, number | 'empty' | 'decoy'>;

const DECOY_PAGE = [1, 2, 3, 4, 5]
	.map(
		(i) =>
			`<div class="r"><a href="https://dictionary.example/why${i}">Why definition ${i}</a><p>meaning and usage</p></div>`,
	)
	.join('');

/** A fake transport session answering per host; records every URL requested. */
function fakeTransport(behaviour: Behaviour, requests: string[]) {
	return {
		session(): TransportSession {
			return {
				async request(url: string) {
					requests.push(url);
					const host = new URL(url).hostname.replace('.test', '');
					const b = behaviour[host] ?? 200;
					const html =
						b === 'empty'
							? '<div class="none"></div>'
							: b === 'decoy'
								? DECOY_PAGE
								: `<div class="r"><a href="https://${host}.example/hit">${host} hit</a><p>about ${host}</p></div>`;
					const body = new TextEncoder().encode(html);
					return {
						url,
						status: typeof b === 'number' ? b : 200,
						headers: new Headers({'content-type': 'text/html'}),
						body,
						text: () => html,
					};
				},
				cookies: () => [],
				clearCookies() {},
			};
		},
	};
}

/** A createSearchcast using real searchcast over the fake transport; records options. */
function fakeFactory(behaviour: Behaviour = {}) {
	const built: SearchcastOptions[] = [];
	const requests: string[] = [];
	const closed: number[] = [];
	const create = (options: SearchcastOptions): Searchcast => {
		built.push(options);
		const real = createSearchcast({
			...options,
			transport: fakeTransport(behaviour, requests),
		});
		return {...real, close: async () => void closed.push(1)};
	};
	return {create, built, requests, closed};
}

function writeProject(value: Record<string, unknown>): void {
	writeJson(join(project, 'webveil.json'), {
		backend: 'searchcast',
		...value,
		searchcast: {
			engines: ['alpha', 'beta'],
			recipes: ['recipes'],
			...(value.searchcast as object),
		},
	});
}

function searchWith(
	create: (o: SearchcastOptions) => Searchcast,
	env: Record<string, string> = {},
	query = 'webveil',
) {
	return search(
		query,
		{cwd, globalPath, env},
		{
			getBackend: (name, config) =>
				name === 'searchcast'
					? createSearchcastBackend(config, {createSearchcast: create})
					: getBackend(name, config),
		},
	);
}

describe('searchcast backend: search through the core', () => {
	it('is registered and constructs without touching config', () => {
		expect(backendNames()).toContain('searchcast');
		const backend = getBackend('searchcast', {
			backend: 'searchcast',
			baseUrl: 'http://127.0.0.1:8080',
			egress: {mode: 'direct'},
			fetchSize: 'm',
		});
		expect(typeof backend.search).toBe('function');
		expect(backend.fetch).toBeUndefined(); // web_fetch stays on distilly
	});

	it('returns results from the first engine that answers, recipes resolved from the project file', async () => {
		writeProject({});
		const fake = fakeFactory();
		const results = await searchWith(fake.create);
		expect(results).toEqual([
			{
				title: 'alpha hit',
				url: 'https://alpha.example/hit',
				snippet: 'about alpha',
			},
		]);
		expect(fake.requests).toEqual(['https://alpha.test/?q=webveil']);
	});

	it('always runs strict, even when a config tries to turn it off', async () => {
		writeProject({searchcast: {strict: false}});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.strict).toBe(true);
	});

	it('passes session idle time and cooldown, env overriding files', async () => {
		writeProject({searchcast: {sessionIdleMs: 1000, cooldownMs: 2000}});
		const fake = fakeFactory();
		await searchWith(fake.create, {WEBVEIL_SEARCHCAST_COOLDOWN_MS: '3000'});
		expect(fake.built[0]).toMatchObject({
			sessionIdleMs: 1000,
			cooldownMs: 3000,
		});
	});

	it('surfaces engines tried before the answering one as unresponsiveEngines', async () => {
		writeProject({});
		const fake = fakeFactory({alpha: 429});
		const results = await searchWith(fake.create);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			url: 'https://beta.example/hit',
			unresponsiveEngines: ['alpha'],
		});
	});

	it('turns an exhausted chain into an error listing each engine, never []', async () => {
		writeProject({});
		const fake = fakeFactory({alpha: 403, beta: 404});
		await expect(searchWith(fake.create)).rejects.toThrow(
			/every engine failed: alpha \(blocked: .*\); beta \(recipe: .*\)/,
		);
	});

	it('returns [] only for a genuine empty answer', async () => {
		writeProject({});
		const fake = fakeFactory({alpha: 'empty'});
		expect(await searchWith(fake.create)).toEqual([]);
	});

	it('turns an impersonation error into one carrying the fix', async () => {
		writeProject({});
		const create = (): Searchcast => ({
			search: () =>
				Promise.reject(new SearchcastError('impersonation', 'not found')),
			clearSessions: async () => {},
			close: async () => {},
		});
		const error = await searchWith(create).catch((e: Error) => e);
		expect(error.message).toMatch(/impersonation is not active \(not found\)/);
		expect(error.message).toMatch(/webveil install-libcurl/);
		expect(error.message).toMatch(/searchcast\.libcurlPath/);
		expect(error.message).toMatch(/WEBVEIL_SEARCHCAST_LIBCURL_PATH/);
	});

	it('fails loud on an unknown engine name and on a missing engine list', async () => {
		writeProject({searchcast: {engines: ['alpha', 'nope']}});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/unknown engine 'nope' \(loaded recipes: alpha, beta\)/,
		);
		writeProject({searchcast: {engines: []}});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/set searchcast\.engines/,
		);
	});

	it('keeps global searchcast keys when the project sets only some (key-by-key merge)', async () => {
		const lib = join(root, 'lib', 'libcurl-impersonate.so');
		writeJson(globalPath, {searchcast: {libcurlPath: lib, cooldownMs: 7}});
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]).toMatchObject({libcurlPath: lib, cooldownMs: 7});
	});
});

describe('searchcast backend: the decoy guard (searchcast.decoyGuard)', () => {
	const QUERY = 'debian kernel upgrade';

	it('reaches createSearchcast from the project file, and is absent by default', async () => {
		writeProject({});
		const plain = fakeFactory();
		await searchWith(plain.create);
		expect(plain.built[0]).not.toHaveProperty('decoyGuard');
		await closeSearchcastInstances();
		writeProject({searchcast: {decoyGuard: ['alpha']}});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.decoyGuard).toEqual(['alpha']);
	});

	it('reaches createSearchcast from the global config (data: any layer)', async () => {
		writeJson(globalPath, {searchcast: {decoyGuard: ['beta']}});
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.decoyGuard).toEqual(['beta']);
	});

	it('reads WEBVEIL_SEARCHCAST_DECOY_GUARD, comma-separated, over the files', async () => {
		writeProject({searchcast: {decoyGuard: ['alpha']}});
		const fake = fakeFactory();
		await searchWith(fake.create, {
			WEBVEIL_SEARCHCAST_DECOY_GUARD: 'engine-a, alpha,,',
		});
		expect(fake.built[0]!.decoyGuard).toEqual(['engine-a', 'alpha']);
	});

	it.each([['engine-a'], [['engine-a', 3]], [{'engine-a': true}]])(
		'fails loud on a value that is not a list of names: %j',
		async (decoyGuard) => {
			writeProject({searchcast: {decoyGuard}});
			const fake = fakeFactory();
			await expect(searchWith(fake.create)).rejects.toThrow(
				/searchcast\.decoyGuard must be a list of engine names/,
			);
			expect(fake.built).toHaveLength(0);
		},
	);

	it('joins the identity key: a different guard is a different identity', () => {
		writeProject({});
		const keyOf = (env: Record<string, string>) =>
			searchcastIdentityKey(resolveConfig({cwd, globalPath, env}));
		expect(keyOf({WEBVEIL_SEARCHCAST_DECOY_GUARD: 'alpha'})).not.toBe(
			keyOf({}),
		);
	});

	it('a guarded engine answering a decoy falls through to the next and shows in unresponsiveEngines', async () => {
		writeProject({searchcast: {decoyGuard: ['alpha']}});
		const fake = fakeFactory({alpha: 'decoy'});
		const results = await searchWith(fake.create, {}, QUERY);
		expect(results).toEqual([
			{
				title: 'beta hit',
				url: 'https://beta.example/hit',
				snippet: 'about beta',
				unresponsiveEngines: ['alpha'],
			},
		]);
		// No cooldown: the next search tries the decoying engine again.
		await searchWith(fake.create, {}, QUERY);
		expect(fake.requests.filter((u) => u.includes('alpha'))).toHaveLength(2);
	});

	it('an unguarded engine answering the same page is returned as is', async () => {
		writeProject({});
		const results = await searchWith(
			fakeFactory({alpha: 'decoy'}).create,
			{},
			QUERY,
		);
		expect(results).toHaveLength(5);
		expect(results[0]!.unresponsiveEngines).toBeUndefined();
	});

	it('every engine failing reports the decoy with its kind', async () => {
		writeProject({searchcast: {decoyGuard: ['alpha']}});
		const fake = fakeFactory({alpha: 'decoy', beta: 403});
		await expect(searchWith(fake.create, {}, QUERY)).rejects.toThrow(
			/every engine failed: alpha \(decoy: .*\); beta \(blocked: .*\)/,
		);
	});
});

describe('searchcast backend: egress becomes the proxy, DNS at the proxy', () => {
	it.each([
		['socks5://u:p@127.0.0.1:9050', 'socks5h://u:p@127.0.0.1:9050'],
		['socks://10.64.0.1:1080', 'socks5h://10.64.0.1:1080'],
		['socks5h://h.example:1080', 'socks5h://h.example:1080'],
	])('maps %s to %s', (url, expected) => {
		expect(searchcastProxy({mode: 'socks5', url})).toBe(expected);
	});

	it('passes http through and direct as no proxy', () => {
		const http = 'http://user:pw@proxy.example:3128';
		expect(searchcastProxy({mode: 'http', url: http})).toBe(http);
		expect(searchcastProxy({mode: 'direct'})).toBeUndefined();
	});

	it('refuses a proxy url that does not match its mode (fail loud)', () => {
		expect(() => searchcastProxy({mode: 'socks5', url: 'http://h:1'})).toThrow(
			EgressError,
		);
		expect(() => searchcastProxy({mode: 'http', url: 'socks5://h:1'})).toThrow(
			EgressError,
		);
		expect(() => searchcastProxy({mode: 'socks5', url: ''})).toThrow(
			EgressError,
		);
	});

	it('hands the mapped egress to searchcast; the default loopback baseUrl does not trip the guard', async () => {
		writeProject({egress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'}});
		const config = resolveConfig({cwd, globalPath, env: {}});
		expect(config.baseUrl).toBe('http://127.0.0.1:8080');
		expect(() => assertEgressAllowsBaseUrl(config)).not.toThrow();
		expect(() =>
			assertEgressAllowsBaseUrl({...config, backend: 'searxng'}),
		).toThrow(EgressError);
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.proxy).toBe('socks5h://127.0.0.1:9050');
	});

	it('passes no proxy for direct egress', async () => {
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.proxy).toBeUndefined();
	});
});

describe('searchcast backend: the libcurl path is an executable setting', () => {
	it('refuses it from a project webveil.json, naming the file and key', async () => {
		writeProject({searchcast: {libcurlPath: '/opt/libcurl-impersonate.so'}});
		const fake = fakeFactory();
		const error = await searchWith(fake.create).catch((e: Error) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect(error.message).toContain(join(project, 'webveil.json'));
		expect(error.message).toContain('searchcast.libcurlPath');
		expect(fake.built).toHaveLength(0);
	});

	it('still refuses it on the derived (unix baseUrl) config path', async () => {
		writeProject({
			baseUrl: 'unix:/nonexistent/socket',
			searchcast: {libcurlPath: '/opt/libcurl-impersonate.so'},
		});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(TrustError);
	});

	it('uses it from the global config, relative to that file', async () => {
		writeJson(globalPath, {searchcast: {libcurlPath: 'lib/libcurl.so'}});
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.libcurlPath).toBe(
			join(dirname(globalPath), 'lib', 'libcurl.so'),
		);
	});

	it('uses it from env (absolute only, never the cwd)', async () => {
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create, {
			WEBVEIL_SEARCHCAST_LIBCURL_PATH: '/abs/libcurl.so',
		});
		expect(fake.built[0]!.libcurlPath).toBe('/abs/libcurl.so');
		await closeSearchcastInstances();
		await expect(
			searchWith(fake.create, {WEBVEIL_SEARCHCAST_LIBCURL_PATH: 'rel.so'}),
		).rejects.toThrow(TrustError);
	});
});

describe('searchcast backend: state persisted per identity (as between CLI calls)', () => {
	const socks = {
		WEBVEIL_EGRESS: 'socks5',
		WEBVEIL_EGRESS_URL: 'socks5://127.0.0.1:9050',
	};
	const keyOf = (env: Record<string, string> = {}) =>
		searchcastIdentityKey(resolveConfig({cwd, globalPath, env}));
	let fileState: string | undefined;
	beforeEach(() => {
		// This test's own state root (inside the temp root), so `all` sees
		// only this test's partitions.
		fileState = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = join(root, 'state');
	});
	afterEach(() => {
		process.env.XDG_STATE_HOME = fileState;
	});

	it('shares sessions and cooldowns across processes with the same config, on disk under the hash only', async () => {
		writeProject({});
		const first = fakeFactory({alpha: 403});
		await searchWith(first.create);
		await closeSearchcastInstances(); // the one-shot CLI process ends
		const dir = partitionDir(keyOf());
		expect(dir).toBe(join(stateRoot(), keyOf()));
		expect(readdirSync(stateRoot())).toContain(keyOf());
		const stored = readFileSync(join(dir, 'state.json'), 'utf8');
		expect(stored).toContain('engine/alpha/cooldown');
		expect(stored).toContain('engine/beta/session');

		// A new process (new instance, alpha healthy now) still sees the cooldown.
		const second = fakeFactory();
		const results = await searchWith(second.create);
		expect(results[0]).toMatchObject({unresponsiveEngines: ['alpha']});
		expect(second.requests).toEqual(['https://beta.test/?q=webveil']);
	});

	it('gives a different egress a different partition that never sees the first one', async () => {
		writeProject({});
		await searchWith(fakeFactory({alpha: 403}).create);
		await closeSearchcastInstances();
		expect(keyOf(socks)).not.toBe(keyOf());
		const other = fakeFactory();
		const results = await searchWith(other.create, socks);
		expect(results[0]!.unresponsiveEngines).toBeUndefined();
		expect(other.requests).toEqual(['https://alpha.test/?q=webveil']);
		expect(existsSync(join(partitionDir(keyOf(socks)), 'state.json'))).toBe(
			true,
		);
	});

	it('clears the current identity only, or every identity with all', async () => {
		writeProject({});
		await searchWith(fakeFactory().create);
		await searchWith(fakeFactory().create, socks);
		const options = {cwd, globalPath};
		expect(
			await clearSearchcastState({...options, env: {...process.env}}),
		).toEqual([keyOf()]);
		expect(existsSync(partitionDir(keyOf()))).toBe(false);
		expect(existsSync(partitionDir(keyOf(socks)))).toBe(true);
		await searchWith(fakeFactory().create);
		expect(
			(await clearSearchcastState({...options, all: true})).sort(),
		).toEqual([keyOf(), keyOf(socks)].sort());
		expect(readdirSync(stateRoot())).toEqual([]);
	});

	it('clears the default chain identity in a folder with no searchcast settings', async () => {
		const env = {...process.env};
		const key = searchcastIdentityKey(resolveConfig({cwd, globalPath, env}));
		mkdirSync(partitionDir(key), {recursive: true});
		writeFileSync(join(partitionDir(key), 'state.json'), '{}');
		expect(await clearSearchcastState({cwd, globalPath, env})).toEqual([key]);
		expect(existsSync(partitionDir(key))).toBe(false);
	});

	it('refuses to guess the current identity when the searchcast section does not resolve, pointing at --all', async () => {
		writeJson(join(project, 'webveil.json'), {
			searchcast: {recipes: ['recipes']},
		});
		await expect(
			clearSearchcastState({cwd, globalPath, env: {...process.env}}),
		).rejects.toThrow(/no searchcast identity to clear here.*--all/);
	});
});

describe('searchcast backend: one cached instance per identity', () => {
	it('reuses the instance across searches, so a cooldown set by the first is seen by the second', async () => {
		writeProject({});
		const fake = fakeFactory({alpha: 403});
		const first = await searchWith(fake.create);
		const second = await searchWith(fake.create);
		expect(fake.built).toHaveLength(1);
		expect(first[0]!.unresponsiveEngines).toEqual(['alpha']);
		expect(second[0]!.unresponsiveEngines).toEqual(['alpha']);
		// alpha was requested once only: the second search skipped it (cooling down).
		expect(fake.requests.filter((u) => u.includes('alpha'))).toHaveLength(1);
		expect(fake.closed).toHaveLength(0);
		await closeSearchcastInstances();
		expect(fake.closed).toHaveLength(1);
	});

	it('gives a different egress a different instance (and identity key)', async () => {
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create);
		await searchWith(fake.create, {
			WEBVEIL_EGRESS: 'socks5',
			WEBVEIL_EGRESS_URL: 'socks5://127.0.0.1:9050',
		});
		expect(fake.built).toHaveLength(2);
		const config: Config = resolveConfig({cwd, globalPath, env: {}});
		const other = carryProvenance(config, {
			...config,
			egress: {mode: 'http' as const, url: 'http://p:1'},
		});
		expect(searchcastIdentityKey(config)).toMatch(/^[0-9a-f]{64}$/);
		expect(searchcastIdentityKey(config)).not.toBe(
			searchcastIdentityKey(other),
		);
		expect(searchcastIdentityKey(config)).toBe(
			searchcastIdentityKey(resolveConfig({cwd, globalPath, env: {}})),
		);
	});

	it('reuses the instance across two MCP tool calls (nothing closed by the handler)', async () => {
		writeProject({});
		const fake = fakeFactory({alpha: 403});
		const cli = createCli({
			search: (query, options) =>
				search(
					query,
					{...options, cwd, globalPath, env: {}},
					{
						getBackend: (_name, config) =>
							createSearchcastBackend(config, {createSearchcast: fake.create}),
					},
				),
		});
		const commands = IncurCli.toCommands.get(cli as never)!;
		const input = new PassThrough();
		const output = new PassThrough();
		const replies = new Map<number, unknown>();
		let buffer = '';
		output.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop()!;
			for (const line of lines)
				if (line.trim()) {
					const msg = JSON.parse(line) as {id?: number; result?: unknown};
					if (msg.id !== undefined) replies.set(msg.id, msg.result);
				}
		});
		await Mcp.serve('webveil', '0.0.0', commands, {input, output});
		const send = (msg: unknown) => input.write(JSON.stringify(msg) + '\n');
		const reply = async (id: number) => {
			for (let i = 0; i < 200 && !replies.has(id); i++)
				await new Promise((r) => setTimeout(r, 10));
			return JSON.stringify(replies.get(id));
		};
		send({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {name: 'test', version: '0'},
			},
		});
		await reply(1);
		send({jsonrpc: '2.0', method: 'notifications/initialized'});
		for (const id of [2, 3]) {
			send({
				jsonrpc: '2.0',
				id,
				method: 'tools/call',
				params: {name: 'search', arguments: {query: 'webveil'}},
			});
			expect(await reply(id)).toContain('beta.example/hit');
		}
		input.end();
		expect(fake.built).toHaveLength(1);
		expect(fake.requests.filter((u) => u.includes('alpha'))).toHaveLength(1);
		expect(fake.closed).toHaveLength(0);
	});
});

describe('searchcast backend: code recipes are executable settings', () => {
	/** A code recipe module whose import writes `marker` (an import-time side effect). */
	function writeCodeRecipe(path: string, name: string): string {
		const marker = `${path}.imported`;
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(
			path,
			`import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'ran');
export default {
	name: ${JSON.stringify(name)},
	async search(query, ctx) {
		await ctx.http.text('https://${name}.test/?q=' + encodeURIComponent(query), {kind: 'document'});
		return [{title: '${name} code hit', url: 'https://${name}.example/code'}];
	},
};
`,
			'utf8',
		);
		return marker;
	}

	it('loads code recipes from the global config (a directory, relative to that file) and runs them in the chain', async () => {
		const marker = writeCodeRecipe(
			join(dirname(globalPath), 'recipes', 'gamma.mjs'),
			'gamma',
		);
		writeFileSync(join(dirname(globalPath), 'recipes', 'notes.txt'), 'x');
		writeJson(globalPath, {searchcast: {codeRecipes: ['recipes']}});
		writeProject({searchcast: {engines: ['gamma', 'alpha']}});
		const fake = fakeFactory();
		expect(await searchWith(fake.create)).toEqual([
			{title: 'gamma code hit', url: 'https://gamma.example/code'},
		]);
		expect(existsSync(marker)).toBe(true);
		// the code recipe's HTTP went through searchcast's transport (the egress)
		expect(fake.requests).toEqual(['https://gamma.test/?q=webveil']);
	});

	it('keeps the global codeRecipes when the project sets only searchcast.engines', async () => {
		const file = join(root, 'private', 'delta.mjs');
		writeCodeRecipe(file, 'delta');
		writeJson(globalPath, {searchcast: {codeRecipes: [file]}});
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['delta']},
		});
		const fake = fakeFactory();
		const results = await searchWith(fake.create);
		expect(results[0]!.url).toBe('https://delta.example/code');
	});

	it('loads them from env (a path-delimited list of absolute paths)', async () => {
		const a = join(root, 'private', 'env-a.mjs');
		const b = join(root, 'private', 'env-b.mjs');
		writeCodeRecipe(a, 'enva');
		writeCodeRecipe(b, 'envb');
		writeProject({searchcast: {engines: ['envb']}});
		const fake = fakeFactory();
		const results = await searchWith(fake.create, {
			WEBVEIL_SEARCHCAST_CODE_RECIPES: [a, b].join(delimiter),
		});
		expect(results[0]!.url).toBe('https://envb.example/code');
	});

	it('refuses a relative env path before importing it (never the cwd)', async () => {
		const marker = writeCodeRecipe(join(cwd, 'rel.mjs'), 'rel');
		writeProject({searchcast: {engines: ['rel']}});
		await expect(
			searchWith(fakeFactory().create, {
				WEBVEIL_SEARCHCAST_CODE_RECIPES: 'rel.mjs',
			}),
		).rejects.toThrow(TrustError);
		expect(existsSync(marker)).toBe(false);
	});

	it('refuses them from a project webveil.json, naming file and key, before any module is imported', async () => {
		const marker = writeCodeRecipe(join(project, 'evil', 'evil.mjs'), 'evil');
		writeProject({searchcast: {engines: ['evil'], codeRecipes: ['evil']}});
		const fake = fakeFactory();
		const error = await searchWith(fake.create).catch((e: Error) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect(error.message).toContain(join(project, 'webveil.json'));
		expect(error.message).toContain('searchcast.codeRecipes');
		expect(existsSync(marker)).toBe(false);
		expect(fake.built).toHaveLength(0);
	});

	it('still refuses them on the derived (unix baseUrl) config path', async () => {
		const marker = writeCodeRecipe(join(project, 'evil.mjs'), 'evil');
		writeProject({
			baseUrl: 'unix:/nonexistent/socket',
			searchcast: {engines: ['evil'], codeRecipes: ['evil.mjs']},
		});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(TrustError);
		expect(existsSync(marker)).toBe(false);
	});

	it('fails loud on a code recipe name already taken by a declarative recipe', async () => {
		const file = join(root, 'private', 'alpha.mjs');
		writeCodeRecipe(file, 'alpha');
		writeJson(globalPath, {searchcast: {codeRecipes: [file]}});
		writeProject({});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/duplicate recipe name 'alpha'/,
		);
	});
});

describe('searchcast backend: installed recipe sets (set:<name>)', () => {
	let dataHome: string | undefined;
	beforeEach(() => {
		dataHome = process.env.XDG_DATA_HOME;
		process.env.XDG_DATA_HOME = join(root, 'data');
	});
	afterEach(() => {
		if (dataHome === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = dataHome;
	});

	/**
	 * Build a set archive (a code recipe `gamma`, a declarative recipe `web`,
	 * a manifest) and install it with searchcast's own `install-recipes` CLI
	 * into the temp XDG_DATA_HOME. Returns the code recipe's import marker.
	 */
	function installSet(name = 'myset'): string {
		const src = join(root, 'archive-src', name);
		const marker = join(root, 'gamma.imported');
		mkdirSync(src, {recursive: true});
		writeFileSync(
			join(src, 'gamma.mjs'),
			`import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'ran');
export default {
	name: 'gamma',
	async search(query, ctx) {
		await ctx.http.text('https://gamma.test/?q=' + encodeURIComponent(query), {kind: 'document'});
		return [{title: 'gamma set hit', url: 'https://gamma.example/set'}];
	},
};
`,
		);
		writeRecipe(join(src, 'web.json'), 'web');
		writeJson(join(src, 'manifest.json'), {name, version: '1.0.0'});
		const archive = join(root, `${name}.tar.gz`);
		const tar = spawnSync('tar', ['czf', archive, '-C', dirname(src), name]);
		expect(tar.status).toBe(0);
		const sha256 = createHash('sha256')
			.update(readFileSync(archive))
			.digest('hex');
		const cli = join(
			dirname(fileURLToPath(import.meta.resolve('searchcast'))),
			'cli.js',
		);
		const install = spawnSync(
			process.execPath,
			[cli, 'install-recipes', archive, '--sha256', sha256],
			{env: {...process.env}, encoding: 'utf8'},
		);
		expect(install.status, install.stderr).toBe(0);
		expect(install.stdout.trim()).toBe(
			join(root, 'data', 'searchcast', 'recipes', name),
		);
		return marker;
	}

	it('loads a set installed by searchcast install-recipes from the global config, code and declarative', async () => {
		const marker = installSet();
		writeJson(globalPath, {
			searchcast: {codeRecipes: ['set:myset'], recipes: ['set:myset']},
		});
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['gamma', 'web']},
		});
		const fake = fakeFactory();
		expect(await searchWith(fake.create)).toEqual([
			{title: 'gamma set hit', url: 'https://gamma.example/set'},
		]);
		expect(existsSync(marker)).toBe(true);
		expect(fake.requests).toEqual(['https://gamma.test/?q=webveil']);
	});

	it("loads the set's declarative recipes without its manifest.json and .source.json, by set: or by path", async () => {
		installSet();
		for (const entry of [
			'set:myset',
			join(root, 'data', 'searchcast', 'recipes', 'myset'),
		]) {
			writeJson(join(project, 'webveil.json'), {
				backend: 'searchcast',
				searchcast: {engines: ['web'], recipes: [entry]},
			});
			const results = await searchWith(fakeFactory().create);
			expect(results[0]!.url).toBe('https://web.example/hit');
			await closeSearchcastInstances();
		}
	});

	it('treats a set placed without install (no .source.json, as home-manager does) the same way', async () => {
		const dir = join(root, 'data', 'searchcast', 'recipes', 'placed');
		writeRecipe(join(dir, 'web.json'), 'web');
		writeJson(join(dir, 'manifest.json'), {name: 'placed', version: '1'});
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['web'], recipes: ['set:placed']},
		});
		const results = await searchWith(fakeFactory().create);
		expect(results[0]!.url).toBe('https://web.example/hit');
	});

	it("still finds a set in serpcast's old data directory, by set: or by path, without its manifest.json", async () => {
		const old = join(root, 'data', 'serpcast', 'recipes', 'legacy');
		writeRecipe(join(old, 'web.json'), 'web');
		writeJson(join(old, 'manifest.json'), {name: 'legacy', version: '1'});
		for (const entry of ['set:legacy', old]) {
			writeJson(join(project, 'webveil.json'), {
				backend: 'searchcast',
				searchcast: {engines: ['web'], recipes: [entry]},
			});
			const results = await searchWith(fakeFactory().create);
			expect(results[0]!.url).toBe('https://web.example/hit');
			await closeSearchcastInstances();
		}
		expect(existsSync(join(root, 'data', 'searchcast'))).toBe(false);
	});

	it("keeps the identity key of a set still in serpcast's old directory (the same resolved path as before)", () => {
		const old = join(root, 'data', 'serpcast', 'recipes', 'legacy');
		writeRecipe(join(old, 'web.json'), 'web');
		const key = (recipes: string[]) =>
			searchcastIdentityKey({
				...resolveConfig({cwd, globalPath, env: {}}),
				searchcast: {engines: ['web'], recipes},
			});
		// searchcast resolved `set:legacy` to this path, so the key is unchanged.
		expect(key(['set:legacy'])).toBe(key([old]));
	});

	it('prefers a set in the new data directory over one of the same name in the old one', async () => {
		const old = join(root, 'data', 'serpcast', 'recipes', 'both');
		writeRecipe(join(old, 'old.json'), 'old');
		const cur = join(root, 'data', 'searchcast', 'recipes', 'both');
		writeRecipe(join(cur, 'web.json'), 'web');
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['web'], recipes: ['set:both']},
		});
		const results = await searchWith(fakeFactory().create);
		expect(results[0]!.url).toBe('https://web.example/hit');
		await closeSearchcastInstances();
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['old'], recipes: ['set:both']},
		});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/unknown engine 'old'/,
		);
	});

	it('takes one file of a set (set:<name>/<file>) and the env form', async () => {
		installSet();
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['gamma']},
		});
		const results = await searchWith(fakeFactory().create, {
			WEBVEIL_SEARCHCAST_CODE_RECIPES: 'set:myset/gamma.mjs',
		});
		expect(results[0]!.url).toBe('https://gamma.example/set');
		await closeSearchcastInstances();
		// a set in a delimited list, beside a path (`:` on POSIX)
		const other = join(root, 'other.mjs');
		writeFileSync(other, "export default {name: 'other', search: () => []};");
		const again = await searchWith(fakeFactory().create, {
			WEBVEIL_SEARCHCAST_CODE_RECIPES: [other, 'set:myset'].join(delimiter),
		});
		expect(again[0]!.url).toBe('https://gamma.example/set');
	});

	it('still refuses code recipes from a project webveil.json, set: included, before importing', async () => {
		const marker = installSet();
		writeJson(join(project, 'webveil.json'), {
			backend: 'searchcast',
			searchcast: {engines: ['gamma'], codeRecipes: ['set:myset']},
		});
		const fake = fakeFactory();
		const error = await searchWith(fake.create).catch((e: Error) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect(error.message).toContain('searchcast.codeRecipes');
		expect(existsSync(marker)).toBe(false);
		expect(fake.built).toHaveLength(0);
	});

	it('fails loud on a set that is not installed, or an entry leaving the set', async () => {
		for (const [entry, message] of [
			['set:missing', /recipe set 'missing' is not installed.*install-recipes/],
			['set:../evil', /not an installed recipe set entry/],
			['set:myset/../x.mjs', /not an installed recipe set entry/],
			['set:a/b/c.mjs', /not an installed recipe set entry/],
		] as const) {
			writeJson(globalPath, {searchcast: {codeRecipes: [entry]}});
			writeProject({});
			await expect(searchWith(fakeFactory().create)).rejects.toThrow(message);
		}
	});
});
