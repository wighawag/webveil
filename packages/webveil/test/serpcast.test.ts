// The serpcast backend, driven through the core search() with REAL serpcast
// (engine chain, cooldowns, declarative recipe runner) over a FAKE transport:
// no live engine traffic and no native library. Config comes from real files in
// a temp dir (project webveil.json + an isolated global config), so trust and
// path resolution are exercised as users hit them.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {PassThrough} from 'node:stream';
import {Cli as IncurCli, Mcp} from 'incur';
import {createSerpcast, SerpcastError} from 'serpcast';
import type {Serpcast, SerpcastOptions, TransportSession} from 'serpcast';
import {
	closeSerpcastInstances,
	createSerpcastBackend,
	serpcastIdentityKey,
	serpcastProxy,
} from '../src/core/backends/serpcast.js';
import {backendNames, getBackend} from '../src/core/backends/registry.js';
import type {Config} from '../src/core/config.js';
import {resolveConfig} from '../src/core/config.js';
import {carryProvenance} from '../src/core/layers.js';
import {assertEgressAllowsBaseUrl, EgressError} from '../src/core/egress.js';
import {search} from '../src/core/search.js';
import {TrustError} from '../src/core/trust.js';
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
	root = mkdtempSync(join(tmpdir(), 'webveil-serpcast-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	cwd = join(project, 'sub', 'dir');
	mkdirSync(cwd, {recursive: true});
	writeRecipe(join(project, 'recipes', 'alpha.json'), 'alpha');
	writeRecipe(join(project, 'recipes', 'beta.json'), 'beta');
});

afterEach(async () => {
	await closeSerpcastInstances();
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

/** Host -> HTTP status the fake transport answers (200 renders one hit). */
type Behaviour = Record<string, number | 'empty'>;

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
							: `<div class="r"><a href="https://${host}.example/hit">${host} hit</a><p>about ${host}</p></div>`;
					const body = new TextEncoder().encode(html);
					return {
						url,
						status: b === 'empty' ? 200 : b,
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

/** A createSerpcast using real serpcast over the fake transport; records options. */
function fakeFactory(behaviour: Behaviour = {}) {
	const built: SerpcastOptions[] = [];
	const requests: string[] = [];
	const closed: number[] = [];
	const create = (options: SerpcastOptions): Serpcast => {
		built.push(options);
		const real = createSerpcast({
			...options,
			transport: fakeTransport(behaviour, requests),
		});
		return {...real, close: async () => void closed.push(1)};
	};
	return {create, built, requests, closed};
}

function writeProject(value: Record<string, unknown>): void {
	writeJson(join(project, 'webveil.json'), {
		backend: 'serpcast',
		...value,
		serpcast: {
			engines: ['alpha', 'beta'],
			recipes: ['recipes'],
			...(value.serpcast as object),
		},
	});
}

function searchWith(
	create: (o: SerpcastOptions) => Serpcast,
	env: Record<string, string> = {},
) {
	return search(
		'webveil',
		{cwd, globalPath, env},
		{
			getBackend: (name, config) =>
				name === 'serpcast'
					? createSerpcastBackend(config, {createSerpcast: create})
					: getBackend(name, config),
		},
	);
}

describe('serpcast backend: search through the core', () => {
	it('is registered and constructs without touching config', () => {
		expect(backendNames()).toContain('serpcast');
		const backend = getBackend('serpcast', {
			backend: 'serpcast',
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
		writeProject({serpcast: {strict: false}});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]!.strict).toBe(true);
	});

	it('passes session idle time and cooldown, env overriding files', async () => {
		writeProject({serpcast: {sessionIdleMs: 1000, cooldownMs: 2000}});
		const fake = fakeFactory();
		await searchWith(fake.create, {WEBVEIL_SERPCAST_COOLDOWN_MS: '3000'});
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
		const create = (): Serpcast => ({
			search: () =>
				Promise.reject(new SerpcastError('impersonation', 'not found')),
			clearSessions: async () => {},
			close: async () => {},
		});
		const error = await searchWith(create).catch((e: Error) => e);
		expect(error.message).toMatch(/impersonation is not active \(not found\)/);
		expect(error.message).toMatch(/npx serpcast install-libcurl/);
		expect(error.message).toMatch(/serpcast\.libcurlPath/);
		expect(error.message).toMatch(/WEBVEIL_SERPCAST_LIBCURL_PATH/);
	});

	it('fails loud on an unknown engine name and on a missing engine list', async () => {
		writeProject({serpcast: {engines: ['alpha', 'nope']}});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/unknown engine 'nope' \(loaded recipes: alpha, beta\)/,
		);
		writeProject({serpcast: {engines: []}});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(
			/set serpcast\.engines/,
		);
	});

	it('keeps global serpcast keys when the project sets only some (key-by-key merge)', async () => {
		const lib = join(root, 'lib', 'libcurl-impersonate.so');
		writeJson(globalPath, {serpcast: {libcurlPath: lib, cooldownMs: 7}});
		writeProject({});
		const fake = fakeFactory();
		await searchWith(fake.create);
		expect(fake.built[0]).toMatchObject({libcurlPath: lib, cooldownMs: 7});
	});
});

describe('serpcast backend: egress becomes the proxy, DNS at the proxy', () => {
	it.each([
		['socks5://u:p@127.0.0.1:9050', 'socks5h://u:p@127.0.0.1:9050'],
		['socks://10.64.0.1:1080', 'socks5h://10.64.0.1:1080'],
		['socks5h://h.example:1080', 'socks5h://h.example:1080'],
	])('maps %s to %s', (url, expected) => {
		expect(serpcastProxy({mode: 'socks5', url})).toBe(expected);
	});

	it('passes http through and direct as no proxy', () => {
		const http = 'http://user:pw@proxy.example:3128';
		expect(serpcastProxy({mode: 'http', url: http})).toBe(http);
		expect(serpcastProxy({mode: 'direct'})).toBeUndefined();
	});

	it('refuses a proxy url that does not match its mode (fail loud)', () => {
		expect(() => serpcastProxy({mode: 'socks5', url: 'http://h:1'})).toThrow(
			EgressError,
		);
		expect(() => serpcastProxy({mode: 'http', url: 'socks5://h:1'})).toThrow(
			EgressError,
		);
		expect(() => serpcastProxy({mode: 'socks5', url: ''})).toThrow(EgressError);
	});

	it('hands the mapped egress to serpcast; the default loopback baseUrl does not trip the guard', async () => {
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

describe('serpcast backend: the libcurl path is an executable setting', () => {
	it('refuses it from a project webveil.json, naming the file and key', async () => {
		writeProject({serpcast: {libcurlPath: '/opt/libcurl-impersonate.so'}});
		const fake = fakeFactory();
		const error = await searchWith(fake.create).catch((e: Error) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect(error.message).toContain(join(project, 'webveil.json'));
		expect(error.message).toContain('serpcast.libcurlPath');
		expect(fake.built).toHaveLength(0);
	});

	it('still refuses it on the derived (unix baseUrl) config path', async () => {
		writeProject({
			baseUrl: 'unix:/nonexistent/socket',
			serpcast: {libcurlPath: '/opt/libcurl-impersonate.so'},
		});
		await expect(searchWith(fakeFactory().create)).rejects.toThrow(TrustError);
	});

	it('uses it from the global config, relative to that file', async () => {
		writeJson(globalPath, {serpcast: {libcurlPath: 'lib/libcurl.so'}});
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
			WEBVEIL_SERPCAST_LIBCURL_PATH: '/abs/libcurl.so',
		});
		expect(fake.built[0]!.libcurlPath).toBe('/abs/libcurl.so');
		await closeSerpcastInstances();
		await expect(
			searchWith(fake.create, {WEBVEIL_SERPCAST_LIBCURL_PATH: 'rel.so'}),
		).rejects.toThrow(TrustError);
	});
});

describe('serpcast backend: one cached instance per identity', () => {
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
		await closeSerpcastInstances();
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
		expect(serpcastIdentityKey(config)).toMatch(/^[0-9a-f]{64}$/);
		expect(serpcastIdentityKey(config)).not.toBe(serpcastIdentityKey(other));
		expect(serpcastIdentityKey(config)).toBe(
			serpcastIdentityKey(resolveConfig({cwd, globalPath, env: {}})),
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
							createSerpcastBackend(config, {createSerpcast: fake.create}),
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
