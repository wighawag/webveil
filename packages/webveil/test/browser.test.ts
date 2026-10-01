// The searchcast browser fallback of the searchcast backend, driven through the
// core search() with REAL searchcast (engine chain, browser runner) built through
// webveil's own seam (`createSearchcast`), over a FAKE transport and a FAKE
// searchcast module (the `importBrowser` seam): no browser is ever launched.
// Endpoint mode talks to a fake `searchcast serve` on a Unix socket in a temp
// dir. Config comes from real files, so trust is exercised as users hit it.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createSearchcast} from 'searchcast';
import type {
	SearchcastModule,
	Searchcast,
	SearchcastOptions,
	TransportSession,
} from 'searchcast';
import {
	closeSearchcastInstances,
	createSearchcastBackend,
	searchcastIdentityKey,
} from '../src/core/backends/searchcast.js';
import type {SearchcastDeps} from '../src/core/backends/searchcast.js';
import {closeBackends, getBackend} from '../src/core/backends/registry.js';
import {resolveConfig} from '../src/core/config.js';
import {EgressError} from '../src/core/egress.js';
import {search} from '../src/core/search.js';
import {TrustError} from '../src/core/trust.js';
import {partitionDir, profileDir, stateRoot} from '../src/core/state.js';

let root: string;
let globalPath: string;
let project: string;
let cwd: string;
let fileState: string | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'webveil-searchcast-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	cwd = join(project, 'sub');
	mkdirSync(cwd, {recursive: true});
	writeRecipe(join(project, 'recipes', 'alpha.json'));
	// This test's own state root (setup-state.ts already isolates the file
	// and asserts the real root untouched).
	fileState = process.env.XDG_STATE_HOME;
	process.env.XDG_STATE_HOME = join(root, 'state');
});

afterEach(async () => {
	await closeSearchcastInstances();
	process.env.XDG_STATE_HOME = fileState;
	rmSync(root, {recursive: true, force: true});
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

function writeRecipe(path: string): void {
	writeJson(path, {
		navigate: {url: 'https://alpha.test/?q={query}'},
		ready: '.r',
		results: {
			item: '.r',
			fields: {title: {selector: 'a'}, url: {selector: 'a', attr: 'href'}},
		},
	});
}

/** Every HTTP engine answers 403 (blocked), so the chain falls to the browser. */
const blockedTransport = {
	session(): TransportSession {
		return {
			async request(url: string) {
				return {
					url,
					status: 403,
					headers: new Headers(),
					body: new Uint8Array(),
					text: () => '',
				};
			},
			cookies: () => [],
			clearCookies() {},
		};
	},
};

type BrowserOptions = ConstructorParameters<
	SearchcastModule['Searchcast']
>[0]['browser'];

/** A fake searchcast module: records how each browser is built, never launches one. */
function fakeSearchcast() {
	const browsers: BrowserOptions[] = [];
	const closed: number[] = [];
	const module: SearchcastModule = {
		Searchcast: class {
			constructor(options: {browser: BrowserOptions}) {
				browsers.push(options.browser);
			}
			async search(recipe: {name: string}, query: string) {
				return {
					results: [
						{
							title: `${recipe.name} browser hit`,
							url: `https://b.example/${query}`,
						},
					],
				};
			}
			async close() {
				closed.push(1);
			}
		},
		findChrome: () => '/usr/bin/fake-chrome',
	};
	return {module, browsers, closed};
}

/** webveil's seams: real searchcast over the blocked transport, options recorded. */
function fakes() {
	const built: SearchcastOptions[] = [];
	const closed: number[] = [];
	const browser = fakeSearchcast();
	const deps: SearchcastDeps = {
		createSearchcast(options): Searchcast {
			built.push(options);
			const real = createSearchcast({...options, transport: blockedTransport});
			return {
				...real,
				close: async () => {
					closed.push(1);
					await real.close();
				},
			};
		},
		importBrowser: async () => browser.module,
	};
	return {deps, built, closed, browser};
}

function writeProject(
	searchcast: Record<string, unknown> = {},
	extra: Record<string, unknown> = {},
): void {
	writeJson(join(project, 'webveil.json'), {
		backend: 'searchcast',
		...extra,
		searchcast: {
			engines: ['alpha', 'browser:alpha'],
			recipes: ['recipes'],
			...searchcast,
		},
	});
}

function searchWith(
	deps: SearchcastDeps,
	env: Record<string, string> = {},
	onWarning?: (message: string) => void,
) {
	return search(
		'webveil',
		{cwd, globalPath, env, ...(onWarning && {onWarning})},
		{
			getBackend: (name, config) =>
				name === 'searchcast'
					? createSearchcastBackend(config, deps)
					: getBackend(name, config),
		},
	);
}

const keyOf = (env: Record<string, string> = {}) =>
	searchcastIdentityKey(resolveConfig({cwd, globalPath, env}));

const socks = (url: string) => ({
	WEBVEIL_EGRESS: 'socks5',
	WEBVEIL_EGRESS_URL: url,
});

describe('searchcast library mode', () => {
	it('falls back to the browser, which gets the egress as its proxy', async () => {
		writeProject();
		const fake = fakes();
		const results = await searchWith(
			fake.deps,
			socks('socks5://127.0.0.1:9050'),
		);
		expect(results).toEqual([
			{
				title: 'alpha browser hit',
				url: 'https://b.example/webveil',
				unresponsiveEngines: ['alpha'],
			},
		]);
		expect(fake.built).toHaveLength(1);
		expect(fake.built[0]!.proxy).toBe('socks5h://127.0.0.1:9050');
		expect(fake.built[0]!.searchcast?.module).toBe(fake.browser.module);
		// searchcast hands that proxy to Chromium (DNS still at the proxy)
		expect(fake.browser.browsers[0]!.proxy).toBe('socks5://127.0.0.1:9050');
		expect(fake.browser.browsers[0]!.executable).toBe('/usr/bin/fake-chrome');
	});

	it('passes an http egress to the browser too', async () => {
		writeProject();
		const fake = fakes();
		await searchWith(fake.deps, {
			WEBVEIL_EGRESS: 'http',
			WEBVEIL_EGRESS_URL: 'http://proxy.example:3128',
		});
		expect(fake.browser.browsers[0]!.proxy).toBe('http://proxy.example:3128');
	});

	it('builds no browser options when no browser engine is listed', async () => {
		writeProject({engines: ['alpha']});
		const fake = fakes();
		await expect(searchWith(fake.deps)).rejects.toThrow(/every engine failed/);
		expect(fake.built[0]!.searchcast).toBeUndefined();
	});

	it('closes the browser with the cached instance (closeBackends)', async () => {
		writeProject();
		const fake = fakes();
		await searchWith(fake.deps);
		await searchWith(fake.deps);
		expect(fake.built).toHaveLength(1);
		expect(fake.browser.browsers).toHaveLength(1);
		expect(fake.browser.closed).toHaveLength(0);
		await closeBackends();
		expect(fake.closed).toHaveLength(1);
		expect(fake.browser.closed).toHaveLength(1);
	});

	it('fails naming the package when @searchcast/browser is not installed', async () => {
		writeProject();
		const fake = fakes();
		const missing = new Error("Cannot find package '@searchcast/browser'");
		const error = await searchWith({
			...fake.deps,
			importBrowser: () => Promise.reject(missing),
		}).catch((e: Error) => e);
		expect(error.message).toMatch(/"@searchcast\/browser" .*is not installed/);
		expect(error.message).toMatch(/npm install @searchcast\/browser/);
		expect(fake.built).toHaveLength(0);
	});

	it('fails naming the package with the real import (@searchcast/browser is an optional peer, not installed here)', async () => {
		writeProject();
		const fake = fakes();
		const {importBrowser: _, ...deps} = fake.deps;
		await expect(searchWith(deps)).rejects.toThrow(
			/npm install @searchcast\/browser/,
		);
	});

	it('refuses a SOCKS egress with credentials, with an explanation', async () => {
		writeProject();
		const fake = fakes();
		const error = await searchWith(
			fake.deps,
			socks('socks5://user:pw@127.0.0.1:9050'),
		).catch((e: Error) => e);
		expect(error).toBeInstanceOf(EgressError);
		expect(error.message).toMatch(
			/Chromium does not support SOCKS authentication/,
		);
		expect(fake.built).toHaveLength(0);
	});

	it('keeps a credentialed SOCKS egress working for HTTP-only engine lists', async () => {
		writeProject({engines: ['alpha']});
		const fake = fakes();
		await expect(
			searchWith(fake.deps, socks('socks5://user:pw@127.0.0.1:9050')),
		).rejects.toThrow(/every engine failed/);
		expect(fake.built[0]!.proxy).toBe('socks5h://user:pw@127.0.0.1:9050');
	});

	it('fails loud on a browser engine without a declarative recipe, and on the reserved prefixes', async () => {
		writeProject({engines: ['browser:nope']});
		await expect(searchWith(fakes().deps)).rejects.toThrow(
			/browser engine 'browser:nope' needs a declarative recipe 'nope' \(loaded declarative recipes: alpha\)/,
		);
		for (const empty of ['browser:', 'searchcast:']) {
			writeProject({engines: [empty]});
			await expect(searchWith(fakes().deps)).rejects.toThrow(
				/'browser:' names no recipe/,
			);
		}
		for (const prefix of ['browser:', 'searchcast:']) {
			const file = join(project, 'recipes', `${prefix}alpha.json`);
			writeRecipe(file);
			writeProject();
			await expect(searchWith(fakes().deps)).rejects.toThrow(
				`recipe name '${prefix}alpha' uses the reserved '${prefix}' prefix ` +
					'(browser engines are named browser:<recipe>)',
			);
			rmSync(file);
		}
	});
});

describe('the old browser engine prefix searchcast:<recipe>', () => {
	it('works as browser:<recipe>, with one warning', async () => {
		writeProject({
			engines: ['alpha', 'searchcast:alpha'],
			decoyGuard: ['searchcast:alpha'],
		});
		const fake = fakes();
		const warnings: string[] = [];
		const results = await searchWith(fake.deps, {}, (m) => warnings.push(m));
		expect(results).toEqual([
			{
				title: 'alpha browser hit',
				url: 'https://b.example/webveil',
				unresponsiveEngines: ['alpha'],
			},
		]);
		expect(fake.built[0]!.searchcast?.module).toBe(fake.browser.module);
		// the guard names the engine searchcast runs, so it still applies
		expect(fake.built[0]!.decoyGuard).toEqual(['browser:alpha']);
		expect(warnings).toEqual([
			expect.stringContaining(
				'`searchcast:alpha` in `searchcast.engines`, `searchcast:alpha` in ' +
					'`searchcast.decoyGuard`',
			),
		]);
		expect(warnings[0]).toContain(
			'use `browser:alpha`, `browser:alpha` instead',
		);
	});

	it('shares the cached instance and state partition of browser:<recipe>', async () => {
		writeProject({engines: ['alpha', 'browser:alpha']});
		const key = keyOf();
		const fake = fakes();
		await searchWith(fake.deps);
		writeProject({engines: ['alpha', 'searchcast:alpha']});
		expect(keyOf()).toBe(key);
		await searchWith(fake.deps);
		expect(fake.built).toHaveLength(1);
	});

	it('is an error next to browser:<recipe> for the same recipe', async () => {
		writeProject({engines: ['searchcast:alpha', 'browser:alpha']});
		const fake = fakes();
		await expect(searchWith(fake.deps)).rejects.toThrow(
			/`searchcast:alpha` and `browser:alpha` in `searchcast.engines`/,
		);
		expect(fake.built).toHaveLength(0);
	});

	it('names the new prefix when a hand-built config (no resolveConfig) still uses it', async () => {
		writeProject();
		const config = resolveConfig({cwd, globalPath, env: {}});
		config.searchcast = {...config.searchcast, engines: ['searchcast:alpha']};
		const error = await createSearchcastBackend(config, fakes().deps)
			.search('q', {} as never)
			.catch((e: Error) => e);
		expect((error as Error).message).toMatch(
			/unknown engine 'searchcast:alpha' .*browser engines are named browser:<recipe>/,
		);
	});
});

describe('engine names around the browser prefix keep their behaviour', () => {
	it('a recipe named `browser` is an ordinary engine, `browser:browser` its browser engine', async () => {
		writeRecipe(join(project, 'recipes', 'browser.json'));
		writeProject({engines: ['browser', 'browser:browser']});
		const fake = fakes();
		const results = await searchWith(fake.deps);
		expect(results).toEqual([
			{
				title: 'browser browser hit',
				url: 'https://b.example/webveil',
				unresponsiveEngines: ['browser'],
			},
		]);
	});

	it('a code recipe whose name holds `:` elsewhere is an ordinary engine', async () => {
		const file = join(root, 'code', 'colon.mjs');
		mkdirSync(dirname(file), {recursive: true});
		writeFileSync(
			file,
			"export default {name: 'foo:bar', async search(q) { return [{title: 'code ' + q, url: 'https://c.example/'}]; }};",
		);
		writeJson(globalPath, {searchcast: {codeRecipes: [file]}});
		writeProject({engines: ['foo:bar']});
		const warnings: string[] = [];
		const results = await searchWith(fakes().deps, {}, (m) => warnings.push(m));
		expect(results).toEqual([
			{title: 'code webveil', url: 'https://c.example/'},
		]);
		expect(warnings).toEqual([]);
	});
});

describe('searchcast executable settings (chrome, xvfb, chrome args)', () => {
	it.each([
		['chrome', '/opt/evil-chrome'],
		['xvfb', '/opt/evil-xvfb'],
		['chromeArgs', ['--disable-web-security']],
	])(
		'refuses %s from a project webveil.json, naming the file and key',
		async (key, value) => {
			writeProject({browser: {[key]: value}});
			const fake = fakes();
			const error = await searchWith(fake.deps).catch((e: Error) => e);
			expect(error).toBeInstanceOf(TrustError);
			expect(error.message).toContain(join(project, 'webveil.json'));
			expect(error.message).toContain(`searchcast.browser.${key}`);
			expect(fake.built).toHaveLength(0);
		},
	);

	it('still refuses them on the derived (unix baseUrl) config path', async () => {
		writeProject(
			{browser: {chrome: '/opt/evil-chrome'}},
			{baseUrl: 'unix:/nonexistent/socket'},
		);
		await expect(searchWith(fakes().deps)).rejects.toThrow(TrustError);
	});

	it('refuses them from a project even with no browser engine listed', async () => {
		writeProject({engines: ['alpha'], browser: {chrome: '/opt/x'}});
		await expect(searchWith(fakes().deps)).rejects.toThrow(TrustError);
	});

	it('uses them from the global config (paths relative to that file)', async () => {
		writeJson(globalPath, {
			searchcast: {
				browser: {
					chrome: 'bin/chrome',
					xvfb: '/usr/bin/Xvfb',
					chromeArgs: ['--lang=en'],
				},
			},
		});
		writeProject();
		const fake = fakes();
		// a fake startXvfb, so the xvfb path reaches the module, no display started
		const started: string[] = [];
		fake.browser.module.startXvfb = async ({executable}) => {
			started.push(executable);
			return {env: {DISPLAY: ':99'}, close: async () => {}};
		};
		await searchWith(fake.deps);
		expect(fake.built[0]!.searchcast).toMatchObject({
			chrome: join(dirname(globalPath), 'bin', 'chrome'),
			xvfb: '/usr/bin/Xvfb',
			chromeArgs: ['--lang=en'],
		});
		expect(fake.browser.browsers[0]).toMatchObject({
			executable: join(dirname(globalPath), 'bin', 'chrome'),
			extraArgs: ['--lang=en'],
			env: {DISPLAY: ':99'},
		});
		expect(started).toEqual(['/usr/bin/Xvfb']);
	});

	it('uses them from env (absolute paths, args split on whitespace)', async () => {
		writeProject();
		const fake = fakes();
		fake.browser.module.startXvfb = async () => ({
			env: {},
			close: async () => {},
		});
		await searchWith(fake.deps, {
			WEBVEIL_SEARCHCAST_BROWSER_CHROME: '/abs/chrome',
			WEBVEIL_SEARCHCAST_BROWSER_XVFB: '/abs/Xvfb',
			WEBVEIL_SEARCHCAST_BROWSER_CHROME_ARGS: ' --a=1   --b ',
		});
		expect(fake.built[0]!.searchcast).toMatchObject({
			chrome: '/abs/chrome',
			xvfb: '/abs/Xvfb',
			chromeArgs: ['--a=1', '--b'],
		});
		await closeSearchcastInstances();
		await expect(
			searchWith(fake.deps, {WEBVEIL_SEARCHCAST_BROWSER_CHROME: 'chrome'}),
		).rejects.toThrow(TrustError);
	});
});

describe('searchcast chrome args that would move the browser off egress', () => {
	const switches = [
		'proxy-server',
		'no-proxy-server',
		'proxy-bypass-list',
		'proxy-pac-url',
		'proxy-auto-detect',
		'winhttp-proxy-resolver',
		'host-resolver-rules',
		'host-rules',
	];
	const mixed = (s: string) =>
		[...s].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');
	const forms = switches.flatMap((name) => [
		[name, `--${name}`],
		[name, `--${name}=http://elsewhere:1`],
		[name, `-${name}`],
		[name, `--${mixed(name)}=x`],
	]);

	it.each(forms)(
		'refuses %s given as %s from the global config',
		async (name, arg) => {
			writeJson(globalPath, {
				searchcast: {browser: {chromeArgs: ['--lang=en', arg]}},
			});
			writeProject();
			const fake = fakes();
			const imported: number[] = [];
			const error = await searchWith({
				...fake.deps,
				importBrowser: async () => {
					imported.push(1);
					return fake.browser.module;
				},
			}).catch((e: Error) => e);
			expect(error).toBeInstanceOf(EgressError);
			expect(error.message).toContain(`'${arg}'`);
			expect(error.message.toLowerCase()).toContain(name);
			expect(error.message).toMatch(/egress/);
			expect(imported).toHaveLength(0);
			expect(fake.built).toHaveLength(0);
			expect(fake.browser.browsers).toHaveLength(0);
		},
	);

	it.each(switches)('refuses --%s from env', async (name) => {
		writeProject();
		const fake = fakes();
		const error = await searchWith(fake.deps, {
			WEBVEIL_SEARCHCAST_BROWSER_CHROME_ARGS: `--lang=en --${name}=x`,
		}).catch((e: Error) => e);
		expect(error).toBeInstanceOf(EgressError);
		expect(error.message).toContain(`'--${name}=x'`);
		expect(fake.built).toHaveLength(0);
	});

	it('refuses them with no browser engine listed', async () => {
		writeJson(globalPath, {
			searchcast: {browser: {chromeArgs: ['--proxy-server=direct://']}},
		});
		writeProject({engines: ['alpha']});
		const fake = fakes();
		await expect(searchWith(fake.deps)).rejects.toThrow(EgressError);
		expect(fake.built).toHaveLength(0);
	});

	it('passes unrelated args (even proxy-like ones) through unchanged', async () => {
		const args = [
			'--lang=en',
			'--window-size=1280,800',
			'--proxy-server-x=1',
			'--enable-features=proxy-server',
			'proxy-server',
		];
		writeJson(globalPath, {searchcast: {browser: {chromeArgs: args}}});
		writeProject();
		const fake = fakes();
		await searchWith(fake.deps);
		expect(fake.built[0]!.searchcast?.chromeArgs).toEqual(args);
		expect(fake.browser.browsers[0]!.extraArgs).toEqual(args);
	});
});

describe('searchcast browser profile, per identity', () => {
	it('is ephemeral by default (searchcast makes and deletes a temp one)', async () => {
		writeProject();
		const fake = fakes();
		await searchWith(fake.deps);
		expect(fake.built[0]!.searchcast?.profile).toBeUndefined();
		const used = fake.browser.browsers[0]!.userDataDir;
		expect(used.startsWith(stateRoot())).toBe(false);
		await closeSearchcastInstances();
		expect(existsSync(used)).toBe(false);
	});

	it('with persistence, lives inside the identity partition and differs per egress', async () => {
		writeProject({browser: {persistProfile: true}});
		const fake = fakes();
		await searchWith(fake.deps);
		const other = socks('socks5://127.0.0.1:9050');
		await searchWith(fake.deps, other);
		const direct = profileDir(partitionDir(keyOf()));
		const proxied = profileDir(partitionDir(keyOf(other)));
		expect(direct.startsWith(partitionDir(keyOf()) + '/')).toBe(true);
		expect(direct).not.toBe(proxied);
		expect(fake.built.map((o) => o.searchcast?.profile)).toEqual([
			direct,
			proxied,
		]);
		expect(fake.browser.browsers.map((b) => b.userDataDir)).toEqual([
			direct,
			proxied,
		]);
	});

	it('is deleted before the next start once idle longer than sessionIdleMs', async () => {
		writeProject({browser: {persistProfile: true}, sessionIdleMs: 60_000});
		const fake = fakes();
		await searchWith(fake.deps);
		const partition = partitionDir(keyOf());
		const profile = profileDir(partition);
		const cookie = join(profile, 'Cookies');
		mkdirSync(profile, {recursive: true});
		writeFileSync(cookie, 'session');

		// Used recently: kept, same instance and browser.
		await searchWith(fake.deps);
		expect(existsSync(cookie)).toBe(true);
		expect(fake.built).toHaveLength(1);

		// Idle past sessionIdleMs: the browser is closed, the profile deleted,
		// then a fresh browser starts on the same (now empty) profile path.
		const old = (Date.now() - 120_000) / 1000;
		utimesSync(join(partition, 'browser-profile.used'), old, old);
		await searchWith(fake.deps);
		expect(fake.closed).toHaveLength(1);
		expect(fake.browser.closed).toHaveLength(1);
		expect(existsSync(cookie)).toBe(false);
		expect(fake.built).toHaveLength(2);
		expect(fake.browser.browsers[1]!.userDataDir).toBe(profile);
	});

	it('is deleted before the first start of a new process when idle', async () => {
		writeProject({browser: {persistProfile: true}, sessionIdleMs: 60_000});
		await searchWith(fakes().deps);
		await closeSearchcastInstances(); // the one-shot CLI process ends
		const partition = partitionDir(keyOf());
		const cookie = join(profileDir(partition), 'Cookies');
		mkdirSync(dirname(cookie), {recursive: true});
		writeFileSync(cookie, 'session');
		const old = (Date.now() - 120_000) / 1000;
		utimesSync(join(partition, 'browser-profile.used'), old, old);
		await searchWith(fakes().deps);
		expect(existsSync(cookie)).toBe(false);
	});
});

describe('searchcast endpoint mode', () => {
	let server: Server | undefined;
	afterEach(async () => {
		await new Promise((r) => (server ? server.close(r) : r(undefined)));
		server = undefined;
	});

	/** A fake `searchcast serve` on a Unix socket; records the request paths. */
	async function serve(): Promise<{socket: string; paths: string[]}> {
		const socket = join(root, 'searchcast.sock');
		const paths: string[] = [];
		server = createServer((req, res) => {
			paths.push(req.url ?? '');
			res.setHeader('content-type', 'application/json');
			res.end(
				JSON.stringify({
					results: [{title: 'served hit', url: 'https://served.example/'}],
				}),
			);
		});
		await new Promise<void>((r) => server!.listen(socket, r));
		return {socket, paths};
	}

	it('names the recipe on the server in either prefix (the old one with a warning)', async () => {
		const {socket, paths} = await serve();
		writeProject({
			engines: ['searchcast:remote'],
			browser: {mode: 'endpoint', endpoint: socket},
		});
		const warnings: string[] = [];
		await searchWith(fakes().deps, {}, (m) => warnings.push(m));
		expect(paths).toEqual(['/search?recipe=remote&q=webveil']);
		expect(warnings).toEqual([expect.stringContaining('`browser:remote`')]);
	});

	it('works with egress direct (the recipe named on the server)', async () => {
		const {socket, paths} = await serve();
		writeProject({browser: {mode: 'endpoint', endpoint: socket}});
		const fake = fakes();
		const results = await searchWith(fake.deps);
		expect(results).toEqual([
			{
				title: 'served hit',
				url: 'https://served.example/',
				unresponsiveEngines: ['alpha'],
			},
		]);
		expect(paths).toEqual(['/search?recipe=alpha&q=webveil']);
		expect(fake.built[0]!.searchcast).toBeUndefined();
	});

	it.each([
		['http', {WEBVEIL_EGRESS: 'http', WEBVEIL_EGRESS_URL: 'http://p:3128'}],
		['socks5', socks('socks5://127.0.0.1:9050')],
	])('is refused with %s egress, with an explanation', async (_, env) => {
		writeProject({
			browser: {mode: 'endpoint', endpoint: '/run/searchcast.sock'},
		});
		const fake = fakes();
		const error = await searchWith(fake.deps, env).catch((e: Error) => e);
		expect(error).toBeInstanceOf(EgressError);
		expect(error.message).toMatch(/endpoint mode cannot be proxied/);
		expect(error.message).toMatch(/egress=direct/);
		expect(fake.built).toHaveLength(0);
	});

	it('fails loud without an endpoint, and on an unknown mode', async () => {
		writeProject({browser: {mode: 'endpoint'}});
		await expect(searchWith(fakes().deps)).rejects.toThrow(
			/endpoint must be set in endpoint mode/,
		);
		writeProject({browser: {mode: 'remote'}});
		await expect(searchWith(fakes().deps)).rejects.toThrow(
			/mode must be 'library' or 'endpoint'/,
		);
	});
});
