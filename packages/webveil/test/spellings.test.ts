// The `serpcast` spellings of webveil 0.10 still work for one release, each
// with one warning naming the new spelling (spellings.ts). Config comes from
// real files and env, so the rewrite is exercised where users hit it: before
// the layers merge, so trust and identity only ever see the new spelling.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {resolveConfig} from '../src/core/config.js';
import type {Config} from '../src/core/config.js';
import {configProvenance} from '../src/core/layers.js';
import {
	configDeprecations,
	normalizeEnv,
	normalizeFileLayer,
	warnOnce,
} from '../src/core/spellings.js';
import {TrustError} from '../src/core/trust.js';
import {identityKey} from '../src/core/identity.js';
import {
	closeSearchcastInstances,
	createSearchcastBackend,
	searchcastIdentityKey,
	trustedLibcurlPath,
} from '../src/core/backends/searchcast.js';
import {getBackend} from '../src/core/backends/registry.js';
import {resolveFetchTransport} from '../src/core/fetch-transport.js';
import {search} from '../src/core/search.js';
import {fetch} from '../src/core/fetch.js';
import {fetchSearchcastTunables} from '../src/core/tunables.js';
import type {Http} from '../src/core/backends/types.js';

const realGlobal = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
	'webveil',
	'config.json',
);
let realGlobalExisted: boolean;
let root: string;
let globalPath: string;
let project: string;
let projectFile: string;

beforeEach(() => {
	realGlobalExisted = existsSync(realGlobal);
	root = mkdtempSync(join(tmpdir(), 'webveil-spellings-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	projectFile = join(project, 'webveil.json');
	mkdirSync(project, {recursive: true});
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

function resolve(env: Record<string, string> = {}): Config {
	return resolveConfig({cwd: project, globalPath, env});
}

/** The resolved config as plain data (provenance and warnings dropped). */
const data = (config: Config) => JSON.parse(JSON.stringify(config));

const browser = {
	mode: 'library',
	chrome: '/opt/chrome',
	xvfb: '/usr/bin/Xvfb',
	chromeArgs: ['--lang=en'],
	persistProfile: true,
	timeoutMs: 9000,
};
const section = {
	engines: ['alpha', 'browser:alpha'],
	recipes: ['/abs/recipes'],
	codeRecipes: ['/abs/code'],
	libcurlPath: '/abs/libcurl.so',
	sessionIdleMs: 1000,
	decoyGuard: {include: ['alpha', 'browser:alpha']},
	decoyRule: {top: 4},
	state: {persist: true},
};
const fetchSection = {maxIdleSessions: 2, timeoutMs: 5000};

/** One whole config, in the new spelling. */
const NEW = {
	backend: 'searchcast',
	fetchTransport: 'searchcast',
	searchcast: {...section, browser},
	fetchSearchcast: fetchSection,
};
/** The same config, every key in the webveil 0.10 spelling. */
const OLD = {
	backend: 'serpcast',
	fetchTransport: 'serpcast',
	serpcast: {
		...section,
		engines: ['alpha', 'searchcast:alpha'],
		decoyGuard: {include: ['alpha', 'searchcast:alpha']},
		searchcast: browser,
	},
	fetchSerpcast: fetchSection,
};

/** Every env setting (one per key family), in the new spelling. */
const NEW_ENV = {
	WEBVEIL_BACKEND: 'searchcast',
	WEBVEIL_FETCH_TRANSPORT: 'searchcast',
	WEBVEIL_SEARCHCAST_LIBCURL_PATH: '/abs/libcurl.so',
	WEBVEIL_SEARCHCAST_CODE_RECIPES: '/abs/code',
	WEBVEIL_SEARCHCAST_TIMEOUT_MS: '7000',
	WEBVEIL_SEARCHCAST_DECOY_GUARD: 'alpha',
	WEBVEIL_SEARCHCAST_DECOY_RULE_TOP: '4',
	WEBVEIL_SEARCHCAST_STATE_PERSIST: 'false',
	WEBVEIL_SEARCHCAST_BROWSER_CHROME: '/opt/chrome',
	WEBVEIL_SEARCHCAST_BROWSER_XVFB: '/usr/bin/Xvfb',
	WEBVEIL_SEARCHCAST_BROWSER_CHROME_ARGS: '--lang=en',
	WEBVEIL_SEARCHCAST_BROWSER_TIMEOUT_MS: '9000',
	WEBVEIL_FETCH_SEARCHCAST_MAX_IDLE_SESSIONS: '2',
	WEBVEIL_FETCH_SEARCHCAST_TIMEOUT_MS: '5000',
};
/** The same env, in the webveil 0.10 spelling. */
const OLD_ENV: Record<string, string> = Object.fromEntries(
	Object.entries(NEW_ENV).map(([name, value]) => [
		name
			.replace('SEARCHCAST_BROWSER_', 'SEARCHCAST_SEARCHCAST_')
			.replace('WEBVEIL_SEARCHCAST_', 'WEBVEIL_SERPCAST_')
			.replace('WEBVEIL_FETCH_SEARCHCAST_', 'WEBVEIL_FETCH_SERPCAST_'),
		value === 'searchcast' ? 'serpcast' : value,
	]),
);

describe('the new spellings', () => {
	it('work from a file, with no warning', () => {
		writeJson(projectFile, NEW);
		const config = resolve();
		expect(config).toMatchObject(NEW);
		expect(configDeprecations(config)).toEqual([]);
		expect(resolveFetchTransport(config)).toBe('searchcast');
		expect(fetchSearchcastTunables(config)).toMatchObject(fetchSection);
		expect(getBackend(config.backend, config)).toBeDefined();
	});

	it('work from env, with no warning', () => {
		const config = resolve(NEW_ENV);
		expect(configDeprecations(config)).toEqual([]);
		expect(config).toMatchObject({
			backend: 'searchcast',
			fetchTransport: 'searchcast',
			searchcast: {
				libcurlPath: '/abs/libcurl.so',
				codeRecipes: ['/abs/code'],
				timeoutMs: 7000,
				decoyGuard: ['alpha'],
				decoyRule: {top: 4},
				state: {persist: false},
				browser: {
					chrome: '/opt/chrome',
					xvfb: '/usr/bin/Xvfb',
					chromeArgs: ['--lang=en'],
					timeoutMs: 9000,
				},
			},
			fetchSearchcast: {maxIdleSessions: 2, timeoutMs: 5000},
		});
	});
});

describe('the old spellings', () => {
	it('resolve from a file exactly as the new ones, with one warning per spelling', () => {
		writeJson(projectFile, NEW);
		const expected = data(resolve());
		writeJson(projectFile, OLD);
		const config = resolve();
		expect(data(config)).toEqual(expected);
		const warnings = configDeprecations(config);
		for (const [old, now] of [
			['`backend: "serpcast"`', '`backend: "searchcast"`'],
			['`fetchTransport: "serpcast"`', '`fetchTransport: "searchcast"`'],
			['`serpcast`', '`searchcast`'],
			['`serpcast.searchcast`', '`searchcast.browser`'],
			['`fetchSerpcast`', '`fetchSearchcast`'],
			[
				'browser engine names `searchcast:alpha` in `searchcast.engines`, ' +
					'`searchcast:alpha` in `searchcast.decoyGuard.include`',
				'`browser:alpha`, `browser:alpha`',
			],
		]) {
			const matching = warnings.filter((w) =>
				w.startsWith(`webveil: ${old} (`),
			);
			expect(matching).toHaveLength(1);
			expect(matching[0]).toContain(projectFile);
			expect(matching[0]).toContain(`use ${now} instead`);
			expect(matching[0]).toContain('removed in the next minor release');
		}
		expect(warnings).toHaveLength(6);
	});

	it('resolve from env exactly as the new ones, with one warning per old prefix', () => {
		const expected = data(resolve(NEW_ENV));
		const config = resolve(OLD_ENV);
		expect(data(config)).toEqual(expected);
		const warnings = configDeprecations(config);
		expect(warnings).toHaveLength(4);
		const serpcast = warnings.find((w) =>
			w.startsWith('webveil: WEBVEIL_SERPCAST_'),
		)!;
		expect(serpcast).toContain('(env)');
		expect(serpcast).toContain('WEBVEIL_SERPCAST_SEARCHCAST_CHROME');
		expect(serpcast).toContain('WEBVEIL_SEARCHCAST_BROWSER_CHROME');
		expect(serpcast).toContain('WEBVEIL_SEARCHCAST_LIBCURL_PATH');
		expect(
			warnings.find((w) => w.startsWith('webveil: WEBVEIL_FETCH_SERPCAST_')),
		).toContain('WEBVEIL_FETCH_SEARCHCAST_MAX_IDLE_SESSIONS');
		expect(warnings).toContainEqual(
			expect.stringContaining('use WEBVEIL_BACKEND=searchcast instead'),
		);
		expect(warnings).toContainEqual(
			expect.stringContaining('use WEBVEIL_FETCH_TRANSPORT=searchcast instead'),
		);
	});

	it.each([
		['WEBVEIL_BACKEND', 'serpcast', {backend: 'searchcast'}],
		['WEBVEIL_FETCH_TRANSPORT', 'serpcast', {fetchTransport: 'searchcast'}],
		['WEBVEIL_SERPCAST_COOLDOWN_MS', '5', {searchcast: {cooldownMs: 5}}],
		[
			'WEBVEIL_SERPCAST_SEARCHCAST_XVFB',
			'/x',
			{searchcast: {browser: {xvfb: '/x'}}},
		],
		[
			'WEBVEIL_FETCH_SERPCAST_SESSION_IDLE_MS',
			'9',
			{fetchSearchcast: {sessionIdleMs: 9}},
		],
	])('%s alone works with one warning', (name, value, expected) => {
		const config = resolve({[name]: value});
		expect(config).toMatchObject(expected);
		expect(configDeprecations(config)).toHaveLength(1);
		expect(configDeprecations(config)[0]).toContain(name);
	});

	it('accepts the half-renamed browser key (searchcast.searchcast.*, WEBVEIL_SEARCHCAST_SEARCHCAST_*) with the same warning', () => {
		writeJson(projectFile, {searchcast: {searchcast: {xvfb: '/x'}}});
		const config = resolve({WEBVEIL_SEARCHCAST_SEARCHCAST_CHROME: '/c'});
		expect(config.searchcast?.browser).toEqual({xvfb: '/x', chrome: '/c'});
		expect(configDeprecations(config)).toEqual([
			expect.stringContaining('`searchcast.searchcast`'),
			expect.stringContaining('use WEBVEIL_SEARCHCAST_BROWSER_CHROME'),
		]);
	});

	it('warns per file: the global and the project file each name themselves', () => {
		writeJson(globalPath, {serpcast: {cooldownMs: 1}});
		writeJson(projectFile, {serpcast: {sessionIdleMs: 2}});
		const warnings = configDeprecations(resolve());
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain(globalPath);
		expect(warnings[1]).toContain(projectFile);
	});

	it('merge with the new spelling in one layer when they set different settings', () => {
		writeJson(projectFile, {
			serpcast: {libcurlPath: '/abs/lib.so', searchcast: {xvfb: '/x'}},
			searchcast: {engines: ['alpha'], browser: {chrome: '/c'}},
		});
		expect(resolve().searchcast).toEqual({
			engines: ['alpha'],
			libcurlPath: '/abs/lib.so',
			browser: {chrome: '/c', xvfb: '/x'},
		});
	});

	it('follow the usual precedence across layers, on the normalised setting', () => {
		writeJson(globalPath, {
			searchcast: {engines: ['g'], cooldownMs: 1},
			backend: 'searxng',
		});
		writeJson(projectFile, {serpcast: {engines: ['p']}, backend: 'serpcast'});
		const config = resolve({WEBVEIL_SEARCHCAST_COOLDOWN_MS: '3'});
		expect(config.backend).toBe('searchcast');
		expect(config.searchcast).toEqual({engines: ['p'], cooldownMs: 3});
		expect(configProvenance(config)!['searchcast.engines']).toEqual({
			layer: 'project',
			path: projectFile,
		});
		// and the other way round: an old env spelling over a new file one
		writeJson(projectFile, {searchcast: {cooldownMs: 2}});
		expect(
			resolve({WEBVEIL_SERPCAST_COOLDOWN_MS: '4'}).searchcast?.cooldownMs,
		).toBe(4);
	});
});

describe('both spellings of one setting in one layer', () => {
	it.each([
		[
			{serpcast: {engines: ['a']}, searchcast: {engines: ['b']}},
			'`serpcast.engines`',
			'`searchcast.engines`',
		],
		[
			{
				serpcast: {state: {persist: false}},
				searchcast: {state: {persist: true}},
			},
			'`serpcast.state.persist`',
			'`searchcast.state.persist`',
		],
		[
			{
				serpcast: {decoyGuard: {include: ['a']}},
				searchcast: {decoyGuard: {exclude: ['b']}},
			},
			'`serpcast.decoyGuard`',
			'`searchcast.decoyGuard`',
		],
		[
			{searchcast: {searchcast: {chrome: '/a'}, browser: {chrome: '/b'}}},
			'`searchcast.searchcast.chrome`',
			'`searchcast.browser.chrome`',
		],
		[
			{fetchSerpcast: {timeoutMs: 1}, fetchSearchcast: {timeoutMs: 2}},
			'`fetchSerpcast.timeoutMs`',
			'`fetchSearchcast.timeoutMs`',
		],
		[{serpcast: 5, searchcast: {}}, '`serpcast`', '`searchcast`'],
	])('is an error naming both (file %#)', (file, old, now) => {
		writeJson(projectFile, file);
		expect(() => resolve()).toThrow(old);
		expect(() => resolve()).toThrow(now);
		expect(() => resolve()).toThrow(projectFile);
	});

	it.each([
		['WEBVEIL_SERPCAST_LIBCURL_PATH', 'WEBVEIL_SEARCHCAST_LIBCURL_PATH'],
		['WEBVEIL_SERPCAST_SEARCHCAST_CHROME', 'WEBVEIL_SEARCHCAST_BROWSER_CHROME'],
		[
			'WEBVEIL_SEARCHCAST_SEARCHCAST_CHROME',
			'WEBVEIL_SEARCHCAST_BROWSER_CHROME',
		],
		[
			'WEBVEIL_FETCH_SERPCAST_TIMEOUT_MS',
			'WEBVEIL_FETCH_SEARCHCAST_TIMEOUT_MS',
		],
	])('is an error naming both (env %s and %s)', (old, now) => {
		const env = {[old]: '/abs/1', [now]: '/abs/2'};
		expect(() => resolve(env)).toThrow(
			new RegExp(`${old} and ${now} are both set \\(env\\)`),
		);
	});

	it('is not an error when one of the two is empty (unset)', () => {
		const config = resolve({
			WEBVEIL_SERPCAST_COOLDOWN_MS: '',
			WEBVEIL_SEARCHCAST_COOLDOWN_MS: '6',
		});
		expect(config.searchcast?.cooldownMs).toBe(6);
		expect(configDeprecations(config)).toEqual([]);
	});

	it('never lets a JSON __proto__ key re-prototype the rewritten layer', () => {
		const layer = JSON.parse(
			'{"serpcast": {"__proto__": {"polluted": true}, "engines": ["a"]}}',
		);
		const {value} = normalizeFileLayer(layer, 'f');
		expect(({} as {polluted?: boolean}).polluted).toBeUndefined();
		expect((value.searchcast as {polluted?: boolean}).polluted).toBeUndefined();
	});
});

describe('trust applies to the setting, whatever its spelling', () => {
	const http = {} as Http;
	const neverBuilt = () => {
		throw new Error('an instance must not be built');
	};
	const refuse = async (key: string) => {
		const backend = createSearchcastBackend(resolve(), {
			createSearchcast: neverBuilt,
		});
		const error = await backend.search('q', http).catch((e: Error) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect((error as Error).message).toContain(key);
		expect((error as Error).message).toContain(projectFile);
	};

	it.each([
		['codeRecipes', ['/abs/code']],
		['libcurlPath', '/abs/libcurl.so'],
	])(
		'refuses %s from a project webveil.json in both spellings',
		async (key, value) => {
			for (const name of ['serpcast', 'searchcast']) {
				writeJson(projectFile, {[name]: {engines: ['a'], [key]: value}});
				await refuse(`searchcast.${key}`);
			}
		},
	);

	it.each([
		['chrome', '/opt/evil-chrome'],
		['xvfb', '/opt/evil-xvfb'],
		['chromeArgs', ['--disable-web-security']],
	])(
		'refuses browser %s from a project webveil.json in every spelling',
		async (key, value) => {
			for (const file of [
				{serpcast: {engines: ['a'], searchcast: {[key]: value}}},
				{searchcast: {engines: ['a'], searchcast: {[key]: value}}},
				{searchcast: {engines: ['a'], browser: {[key]: value}}},
			]) {
				writeJson(projectFile, file);
				await refuse(`searchcast.browser.${key}`);
			}
		},
	);

	it('refuses a project libcurlPath for the fetch transport in both spellings', () => {
		for (const name of ['serpcast', 'searchcast']) {
			writeJson(projectFile, {[name]: {libcurlPath: '/abs/libcurl.so'}});
			expect(() => trustedLibcurlPath(resolve())).toThrow(TrustError);
		}
	});

	it('accepts both spellings from the global config and from env', async () => {
		writeJson(globalPath, {serpcast: {libcurlPath: '/abs/g.so'}});
		expect(trustedLibcurlPath(resolve())).toBe('/abs/g.so');
		expect(
			trustedLibcurlPath(resolve({WEBVEIL_SERPCAST_LIBCURL_PATH: '/abs/e.so'})),
		).toBe('/abs/e.so');
	});
});

describe('identity key', () => {
	it('is the same whichever spelling a config file uses', () => {
		writeJson(globalPath, NEW);
		const key = searchcastIdentityKey(resolve());
		writeJson(globalPath, OLD);
		expect(searchcastIdentityKey(resolve())).toBe(key);
	});

	it('is the same from env in either spelling', () => {
		writeJson(projectFile, {searchcast: {engines: ['alpha']}});
		const {WEBVEIL_SEARCHCAST_STATE_PERSIST: _n, ...newEnv} = NEW_ENV;
		const {WEBVEIL_SERPCAST_STATE_PERSIST: _o, ...oldEnv} = OLD_ENV;
		expect(searchcastIdentityKey(resolve(oldEnv))).toBe(
			searchcastIdentityKey(resolve(newEnv)),
		);
	});

	it('is the key webveil 0.10 computed (the browser subsection hashed as `searchcast`, browser engines as `searchcast:<recipe>`)', () => {
		writeJson(globalPath, NEW);
		const config = resolve();
		const {browser: b, ...rest} = config.searchcast!;
		expect(rest.engines).toEqual(['alpha', 'browser:alpha']);
		expect(searchcastIdentityKey(config)).toBe(
			identityKey(config.egress, {
				...rest,
				engines: ['alpha', 'searchcast:alpha'],
				decoyGuard: {include: ['alpha', 'searchcast:alpha']},
				searchcast: b,
			}),
		);
	});
});

describe('warnings reach the caller', () => {
	it('search hands each warning to onWarning before the backend runs', async () => {
		writeJson(projectFile, {backend: 'serpcast', searchcast: {engines: []}});
		const warnings: string[] = [];
		const error = await search('q', {
			cwd: project,
			globalPath,
			env: {},
			onWarning: (m) => warnings.push(m),
		}).catch((e: Error) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(/set searchcast\.engines/);
		expect(warnings).toEqual([
			expect.stringContaining('use `backend: "searchcast"` instead'),
		]);
	});

	it('fetch hands each warning to onWarning', async () => {
		writeJson(projectFile, {fetchSerpcast: {timeoutMs: 0}});
		const warnings: string[] = [];
		await fetch('http://127.0.0.1:1/', {
			cwd: project,
			globalPath,
			env: {WEBVEIL_FETCH_TRANSPORT: 'searchcast'},
			onWarning: (m) => warnings.push(m),
		}).catch(() => undefined);
		expect(warnings).toEqual([expect.stringContaining('`fetchSearchcast`')]);
	});

	it('by default prints each distinct warning once per process on stderr', () => {
		const write = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);
		try {
			const message = `webveil: test warning ${Math.random()}`;
			warnOnce(message);
			warnOnce(message);
			expect(write).toHaveBeenCalledTimes(1);
			expect(write).toHaveBeenCalledWith(`${message}\n`);
		} finally {
			write.mockRestore();
		}
	});
});

describe('the browser engine prefix (searchcast:<recipe> is now browser:<recipe>)', () => {
	it('`browser:<recipe>` resolves with no warning', () => {
		writeJson(projectFile, {searchcast: {engines: ['a', 'browser:a']}});
		const config = resolve();
		expect(config.searchcast?.engines).toEqual(['a', 'browser:a']);
		expect(configDeprecations(config)).toEqual([]);
	});

	it('`searchcast:<recipe>` resolves as `browser:<recipe>` with one warning per file, naming each', () => {
		writeJson(globalPath, {
			searchcast: {decoyGuard: ['searchcast:g']},
		});
		writeJson(projectFile, {
			searchcast: {
				engines: ['a', 'searchcast:a', 'searchcast:b'],
				decoyGuard: {include: ['searchcast:a'], exclude: ['searchcast:b']},
			},
		});
		const config = resolve();
		expect(config.searchcast?.engines).toEqual(['a', 'browser:a', 'browser:b']);
		expect(config.searchcast?.decoyGuard).toEqual({
			include: ['browser:a'],
			exclude: ['browser:b'],
		});
		const warnings = configDeprecations(config);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toBe(
			`webveil: browser engine name \`searchcast:g\` in \`searchcast.decoyGuard\` (${globalPath}) ` +
				'is a deprecated spelling, removed in the next minor release: use `browser:g` instead.',
		);
		expect(warnings[1]).toContain(projectFile);
		for (const part of [
			'`searchcast:a` in `searchcast.engines`',
			'`searchcast:b` in `searchcast.engines`',
			'`searchcast:a` in `searchcast.decoyGuard.include`',
			'`searchcast:b` in `searchcast.decoyGuard.exclude`',
			'use `browser:a`, `browser:b`, `browser:a`, `browser:b` instead',
		])
			expect(warnings[1]).toContain(part);
	});

	it('is rewritten inside an old `serpcast` section too', () => {
		writeJson(projectFile, {serpcast: {engines: ['searchcast:a']}});
		const config = resolve();
		expect(config.searchcast?.engines).toEqual(['browser:a']);
		expect(configDeprecations(config)).toEqual([
			expect.stringContaining('use `searchcast` instead'),
			expect.stringContaining('use `browser:a` instead'),
		]);
	});

	it('in the env decoy guard lists, with one warning naming the variables', () => {
		const config = resolve({
			WEBVEIL_SEARCHCAST_DECOY_GUARD: 'a, searchcast:a',
			WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE: 'searchcast:b',
		});
		expect(config.searchcast?.decoyGuard).toEqual({
			include: ['a', 'browser:a'],
			exclude: ['browser:b'],
		});
		expect(configDeprecations(config)).toEqual([
			'webveil: browser engine names searchcast:a in WEBVEIL_SEARCHCAST_DECOY_GUARD, ' +
				'searchcast:b in WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE (env) is a deprecated ' +
				'spelling, removed in the next minor release: use browser:a, browser:b instead.',
		]);
	});

	it.each([
		[{engines: ['searchcast:a', 'x', 'browser:a']}, '`searchcast.engines`'],
		[{decoyGuard: ['browser:a', 'searchcast:a']}, '`searchcast.decoyGuard`'],
		[
			{decoyGuard: {exclude: ['searchcast:a', 'browser:a']}},
			'`searchcast.decoyGuard.exclude`',
		],
	])(
		'both spellings of one browser engine in one list is an error naming both (%#)',
		(section, label) => {
			writeJson(projectFile, {searchcast: section});
			expect(() => resolve()).toThrow(
				`webveil: \`searchcast:a\` and \`browser:a\` in ${label} (${projectFile}) ` +
					'are two spellings of the same browser engine. Keep `browser:a` and ' +
					'remove `searchcast:a` (the old spelling is removed in the next minor release).',
			);
		},
	);

	it('both spellings in an env list is an error naming both', () => {
		expect(() =>
			resolve({WEBVEIL_SEARCHCAST_DECOY_GUARD: 'searchcast:a,browser:a'}),
		).toThrow(
			/`searchcast:a` and `browser:a` in WEBVEIL_SEARCHCAST_DECOY_GUARD \(env\)/,
		);
	});

	it('different recipes in two spellings, or one spelling per layer, are no error', () => {
		writeJson(globalPath, {searchcast: {engines: ['browser:a']}});
		writeJson(projectFile, {
			searchcast: {engines: ['searchcast:a', 'browser:b']},
		});
		expect(resolve().searchcast?.engines).toEqual(['browser:a', 'browser:b']);
	});

	it('leaves other values alone (a name holding `:` elsewhere, a non-string, a non-list)', () => {
		const {value, deprecations} = normalizeFileLayer(
			{searchcast: {engines: ['foo:bar', 'browser', 3], decoyGuard: 'x'}},
			'f',
		);
		expect(value).toEqual({
			searchcast: {engines: ['foo:bar', 'browser', 3], decoyGuard: 'x'},
		});
		expect(deprecations).toEqual([]);
	});

	it('gives the same identity key either way (file and env)', () => {
		const chain = (prefix: string) => ({
			searchcast: {
				engines: ['alpha', `${prefix}alpha`],
				decoyGuard: [`${prefix}alpha`],
			},
		});
		writeJson(globalPath, chain('browser:'));
		const key = searchcastIdentityKey(resolve());
		writeJson(globalPath, chain('searchcast:'));
		expect(searchcastIdentityKey(resolve())).toBe(key);
		// and the key is the one webveil 0.12 computed for the old spelling
		const old = resolve();
		expect(key).toBe(
			identityKey(old.egress, {
				engines: ['alpha', 'searchcast:alpha'],
				decoyGuard: ['searchcast:alpha'],
			}),
		);
		writeJson(globalPath, {searchcast: {engines: ['browser:alpha']}});
		const env = (guard: string) =>
			searchcastIdentityKey(resolve({WEBVEIL_SEARCHCAST_DECOY_GUARD: guard}));
		expect(env('searchcast:alpha')).toBe(env('browser:alpha'));
	});

	it.each(['browser:', 'searchcast:'])(
		'keeps the trust rules with %s engines: a project cannot set the browser executables',
		async (prefix) => {
			for (const key of ['chrome', 'xvfb', 'chromeArgs']) {
				writeJson(projectFile, {
					searchcast: {
						engines: [`${prefix}a`],
						browser: {[key]: key === 'chromeArgs' ? ['--x'] : '/opt/x'},
					},
				});
				const backend = createSearchcastBackend(resolve(), {
					createSearchcast: () => {
						throw new Error('an instance must not be built');
					},
				});
				const error = await backend
					.search('q', {} as Http)
					.catch((e: Error) => e);
				expect(error).toBeInstanceOf(TrustError);
				expect((error as Error).message).toContain(`searchcast.browser.${key}`);
			}
		},
	);
});

describe('normalizeEnv', () => {
	it('leaves unrelated variables alone', () => {
		const env = {PATH: '/bin', WEBVEIL_EGRESS: 'direct', EMPTY: ''};
		expect(normalizeEnv(env)).toEqual({env, deprecations: []});
	});
});
