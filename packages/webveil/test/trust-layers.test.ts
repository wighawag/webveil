import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, win32} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {resolveConfig} from '../src/core/config.js';
import {configProvenance} from '../src/core/layers.js';
import {
	assertTrusted,
	isCommandPath,
	resolveCommandOnPath,
	resolveExecutablePath,
	TrustError,
} from '../src/core/trust.js';
import {createCustomBackend} from '../src/core/backends/custom.js';
import type {SpawnFn} from '../src/core/backends/custom.js';
import {search} from '../src/core/search.js';
import {fetch} from '../src/core/fetch.js';
import {buildDispatcher, fetchEgressConfig} from '../src/core/egress.js';
import type {Http} from '../src/core/backends/types.js';

// Every test isolates the global config dir under a temp XDG_CONFIG_HOME and
// asserts the real one is untouched.
const realGlobal = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
	'webveil',
	'config.json',
);
let realGlobalExisted: boolean;
let root: string;
let xdg: string;
let globalFile: string;
let cwd: string;

beforeEach(() => {
	realGlobalExisted = existsSync(realGlobal);
	root = mkdtempSync(join(tmpdir(), 'webveil-trust-'));
	xdg = join(root, 'xdg');
	globalFile = join(xdg, 'webveil', 'config.json');
	cwd = join(root, 'repo');
	mkdirSync(cwd, {recursive: true});
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
	expect(existsSync(realGlobal)).toBe(realGlobalExisted);
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

/** An executable script printing one result titled `tag`. */
function writeScript(path: string, tag: string): string {
	mkdirSync(dirname(path), {recursive: true});
	const hit = JSON.stringify([{title: tag, url: `https://example.com/${tag}`}]);
	writeFileSync(path, `#!/bin/sh\ncat >/dev/null\necho '${hit}'\n`, 'utf8');
	chmodSync(path, 0o755);
	return path;
}

function resolveHere(env: Record<string, string> = {}) {
	return resolveConfig({cwd, env: {XDG_CONFIG_HOME: xdg, ...env}});
}

function searchHere(env: Record<string, string> = {}) {
	return search('q', {cwd, env: {XDG_CONFIG_HOME: xdg, ...env}});
}

/** A fake spawn recording the executable, answering with an empty list. */
function recordingSpawn(calls: string[]): SpawnFn {
	return ((exe: string) => {
		calls.push(exe);
		const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.stdin = new PassThrough();
		setImmediate(() => {
			(child.stdout as PassThrough).end('[]');
			(child.stderr as PassThrough).end();
			setImmediate(() => child.emit('close', 0));
		});
		return child;
	}) as unknown as SpawnFn;
}

const unusedHttp = {} as Http;

describe('deep merge of config sections', () => {
	it('keeps the global keys of a section the project only partly sets; arrays replace whole', () => {
		writeJson(globalFile, {
			searchcast: {engines: ['a', 'b'], timeoutMs: 5, nested: {x: 1, y: 2}},
		});
		writeJson(join(cwd, 'webveil.json'), {
			searchcast: {engines: ['c'], nested: {y: 3}},
		});
		const cfg = resolveHere() as unknown as Record<string, unknown>;
		expect(cfg.searchcast).toEqual({
			engines: ['c'],
			timeoutMs: 5,
			nested: {x: 1, y: 3},
		});
	});

	it('replaces egress whole: global socks5 under project direct is exactly direct', () => {
		writeJson(globalFile, {
			egress: {mode: 'socks5', url: 'socks5h://127.0.0.1:9050'},
		});
		writeJson(join(cwd, 'webveil.json'), {egress: {mode: 'direct'}});
		expect(resolveHere().egress).toStrictEqual({mode: 'direct'});
	});

	it('replaces egress/fetchEgress whole: project http without url still fails loud', () => {
		writeJson(globalFile, {
			fetchEgress: {mode: 'socks5', url: 'socks5h://127.0.0.1:9050'},
			egress: {mode: 'socks5', url: 'socks5h://127.0.0.1:9050'},
		});
		writeJson(join(cwd, 'webveil.json'), {
			fetchEgress: {mode: 'http'},
			egress: {mode: 'http'},
		});
		const cfg = resolveHere();
		expect(cfg.fetchEgress).toStrictEqual({mode: 'http'});
		expect(cfg.egress).toStrictEqual({mode: 'http'});
		expect(() => buildDispatcher(cfg)).toThrow(
			/egress http: could not build proxy/,
		);
		expect(() => buildDispatcher(fetchEgressConfig(cfg))).toThrow(
			/egress http: could not build proxy/,
		);
	});
});

describe('provenance', () => {
	it('records a source for every resolved leaf, with the file path for file layers', () => {
		writeJson(globalFile, {fetchSize: 'l', searchcast: {engines: ['a']}});
		writeJson(join(cwd, 'webveil.json'), {
			backend: 'custom',
			searchcast: {timeoutMs: 1},
		});
		const provenance = configProvenance(
			resolveHere({WEBVEIL_BASE_URL: '/bin/true'}),
		);
		expect(provenance).toEqual({
			backend: {layer: 'project', path: join(cwd, 'webveil.json')},
			baseUrl: {layer: 'env'},
			egress: {layer: 'defaults'},
			fetchSize: {layer: 'global', path: globalFile},
			'searchcast.engines': {layer: 'global', path: globalFile},
			'searchcast.timeoutMs': {
				layer: 'project',
				path: join(cwd, 'webveil.json'),
			},
		});
	});

	it('does not change the config shape (provenance is not an own enumerable key)', () => {
		expect(Object.keys(resolveHere()).sort()).toEqual([
			'backend',
			'baseUrl',
			'egress',
			'fetchSize',
		]);
	});
});

describe('trust check on the custom command', () => {
	it('refuses a command from a project webveil.json, naming the file and key', async () => {
		const script = writeScript(join(root, 'bin', 'evil.sh'), 'evil');
		writeJson(join(cwd, 'webveil.json'), {backend: 'custom', baseUrl: script});
		const error = await searchHere().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect((error as Error).message).toContain(join(cwd, 'webveil.json'));
		expect((error as Error).message).toContain('`baseUrl`');
		expect((error as Error).message).toMatch(/global config.*env/);
	});

	it('runs the same command from the global config', async () => {
		const script = writeScript(join(root, 'bin', 'ok.sh'), 'global');
		writeJson(globalFile, {backend: 'custom', baseUrl: script});
		const results = await searchHere();
		expect(results.map((r) => r.title)).toEqual(['global']);
	});

	it('runs the same command from env', async () => {
		const script = writeScript(join(root, 'bin', 'ok.sh'), 'env');
		const results = await searchHere({
			WEBVEIL_BACKEND: 'custom',
			WEBVEIL_BASE_URL: script,
		});
		expect(results.map((r) => r.title)).toEqual(['env']);
	});

	it('accepts backend: custom from the project when the command is trusted', async () => {
		const script = writeScript(join(root, 'bin', 'ok.sh'), 'trusted');
		writeJson(globalFile, {baseUrl: script});
		writeJson(join(cwd, 'webveil.json'), {backend: 'custom'});
		const results = await searchHere();
		expect(results.map((r) => r.title)).toEqual(['trusted']);
	});

	it('keeps web_fetch working where the project config names a command', async () => {
		writeJson(join(cwd, 'webveil.json'), {
			backend: 'custom',
			baseUrl: './evil.sh',
		});
		const result = await fetch(
			'https://example.com/',
			{cwd, env: {XDG_CONFIG_HOME: xdg}},
			{
				extract: async (url) => ({url, markdown: 'ok', truncated: false}),
			},
		);
		expect(result.markdown).toBe('ok');
	});

	it('trusts a config built in code (no provenance)', () => {
		expect(() =>
			assertTrusted({baseUrl: '/bin/true'}, ['baseUrl']),
		).not.toThrow();
	});

	it('refuses a nested leaf under an executable section path', () => {
		writeJson(join(cwd, 'webveil.json'), {searchcast: {code: {dir: '/x'}}});
		expect(() => assertTrusted(resolveHere(), ['searchcast.code'])).toThrow(
			/searchcast\.code\.dir/,
		);
	});
});

describe('executable path resolution never uses the cwd', () => {
	beforeEach(() => {
		// Decoys a cwd-relative resolution would pick up.
		writeScript(join(cwd, '~', 'x'), 'cwd-tilde');
		writeScript(join(cwd, 'bin', 'search.sh'), 'cwd-relative');
		process.chdir(cwd);
	});
	const originalCwd = process.cwd();
	afterEach(() => process.chdir(originalCwd));

	it('expands a global ~/x under the home directory', async () => {
		writeJson(globalFile, {backend: 'custom', baseUrl: '~/x --flag'});
		const calls: string[] = [];
		const backend = createCustomBackend(resolveHere(), recordingSpawn(calls));
		await backend.search('q', unusedHttp);
		expect(calls).toEqual([join(homedir(), 'x')]);
		expect(calls[0]!.startsWith(cwd)).toBe(false);
	});

	it('resolves a relative global path against the global config directory', async () => {
		writeScript(join(xdg, 'webveil', 'bin', 'search.sh'), 'global-relative');
		writeJson(globalFile, {backend: 'custom', baseUrl: 'bin/search.sh'});
		const results = await searchHere();
		expect(results.map((r) => r.title)).toEqual(['global-relative']);
	});

	it('refuses a relative path from env', async () => {
		await expect(
			searchHere({
				WEBVEIL_BACKEND: 'custom',
				WEBVEIL_BASE_URL: 'bin/search.sh',
			}),
		).rejects.toThrow(/must be absolute or start with ~\//);
	});

	it('keeps PATH lookup for a bare command name, spawning the absolute match', async () => {
		writeJson(globalFile, {backend: 'custom', baseUrl: 'sh -c true'});
		const calls: string[] = [];
		const backend = createCustomBackend(resolveHere(), recordingSpawn(calls));
		await backend.search('q', unusedHttp);
		expect(calls).toHaveLength(1);
		expect(isAbsolute(calls[0]!)).toBe(true);
		expect(basename(calls[0]!)).toBe('sh');
	});

	it('resolveCommandOnPath honours PATHEXT on Windows', () => {
		const dir = join(root, 'winbin');
		writeScript(join(dir, 'tool.CMD'), 'win');
		const opts = {
			env: {PATH: `.;${dir}`, PATHEXT: '.EXE;.CMD'},
			platform: 'win32' as const,
		};
		expect(resolveCommandOnPath('tool', opts)).toBe(join(dir, 'tool.CMD'));
		expect(resolveCommandOnPath('tool.CMD', opts)).toBe(join(dir, 'tool.CMD'));
	});

	it('resolveExecutablePath: ~ uses the given home, relative uses the file dir', () => {
		const file = {layer: 'global', path: '/etc/webveil/config.json'} as const;
		expect(resolveExecutablePath('~/a', file, '/home/u')).toBe('/home/u/a');
		expect(resolveExecutablePath('./a', file)).toBe('/etc/webveil/a');
		expect(resolveExecutablePath('/abs/a', {layer: 'env'})).toBe('/abs/a');
		expect(() => resolveExecutablePath('a/b', {layer: 'env'})).toThrow(
			TrustError,
		);
		expect(() => resolveExecutablePath('a/b', undefined)).toThrow(TrustError);
	});
});

describe('bare command PATH lookup skips empty and relative entries', () => {
	const originalCwd = process.cwd();
	const originalPath = process.env.PATH;
	let absDir: string;
	let marker: string;

	beforeEach(() => {
		absDir = join(root, 'absbin');
		marker = join(root, 'decoy-ran');
		writeScript(join(absDir, 'wvsearch'), 'absolute');
		// Decoys in the cwd (and a relative `bin` under it) that must never run.
		for (const decoy of [join(cwd, 'wvsearch'), join(cwd, 'bin', 'wvsearch')]) {
			mkdirSync(dirname(decoy), {recursive: true});
			writeFileSync(
				decoy,
				`#!/bin/sh\ncat >/dev/null\ntouch '${marker}'\necho '[{"title":"decoy","url":"https://example.com/decoy"}]'\n`,
				'utf8',
			);
			chmodSync(decoy, 0o755);
		}
		writeJson(globalFile, {backend: 'custom', baseUrl: 'wvsearch'});
		process.chdir(cwd);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		process.env.PATH = originalPath;
	});

	for (const [label, prefix] of [
		['a `.` entry', '.'],
		['an empty entry', ''],
		['a relative `bin` entry', 'bin'],
	] as const) {
		it(`runs the absolute-dir executable, never the cwd decoy, with ${label}`, async () => {
			process.env.PATH = `${prefix}:${absDir}`;
			const results = await searchHere();
			expect(results.map((r) => r.title)).toEqual(['absolute']);
			expect(existsSync(marker)).toBe(false);
		});
	}

	it('fails clearly before spawning when only relative entries match', async () => {
		process.env.PATH = `.::bin`;
		const calls: string[] = [];
		const backend = createCustomBackend(resolveHere(), recordingSpawn(calls));
		const error = await backend
			.search('q', unusedHttp)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect((error as Error).message).toContain("'wvsearch'");
		expect((error as Error).message).toMatch(
			/relative PATH entries are ignored/,
		);
		expect(calls).toEqual([]);
		expect(existsSync(marker)).toBe(false);
	});

	it('skips a non-executable match and a directory of that name', () => {
		const first = join(root, 'first');
		mkdirSync(join(first, 'wvsearch'), {recursive: true});
		const second = join(root, 'second');
		mkdirSync(second, {recursive: true});
		writeFileSync(join(second, 'wvsearch'), 'x', 'utf8');
		expect(
			resolveCommandOnPath('wvsearch', {
				env: {PATH: `${first}:${second}:${absDir}`},
			}),
		).toBe(join(absDir, 'wvsearch'));
	});
});

describe('Windows command paths (platform seam)', () => {
	const file = {
		layer: 'global',
		path: 'C:\\cfg\\webveil\\config.json',
	} as const;
	const home = 'C:\\Users\\u';
	const win = (
		value: string,
		source: Parameters<typeof resolveExecutablePath>[1],
	) => resolveExecutablePath(value, source, home, 'win32');

	it('classifies backslash, forward-slash and drive-prefixed values as paths on win32', () => {
		for (const value of [
			'C:\\x\\y.exe',
			'C:/x/y.exe',
			'\\\\srv\\share\\y.exe',
			'bin\\y.cmd',
			'.\\y.cmd',
			'bin/y.cmd',
			'C:y.exe',
		])
			expect(isCommandPath(value, 'win32')).toBe(true);
		expect(isCommandPath('search', 'win32')).toBe(false);
		expect(isCommandPath('search.exe', 'win32')).toBe(false);
	});

	it('keeps a backslash-only name a bare name on POSIX', () => {
		expect(isCommandPath('bin\\y', 'linux')).toBe(false);
		expect(isCommandPath('C:y', 'linux')).toBe(false);
		expect(isCommandPath('bin/y', 'linux')).toBe(true);
		expect(
			resolveExecutablePath(
				'./a\\b',
				{layer: 'global', path: '/etc/w/c.json'},
				'/h',
				'linux',
			),
		).toBe('/etc/w/a\\b');
	});

	it('treats drive-letter and UNC paths as absolute, from any layer', () => {
		for (const source of [file, {layer: 'env'} as const, undefined]) {
			expect(win('C:\\x\\y.exe', source)).toBe('C:\\x\\y.exe');
			expect(win('C:/x/y.exe', source)).toBe('C:/x/y.exe');
			expect(win('\\\\srv\\share\\y.exe', source)).toBe(
				'\\\\srv\\share\\y.exe',
			);
		}
	});

	it('resolves Windows-relative paths against the config-file directory', () => {
		expect(win('bin\\y.cmd', file)).toBe('C:\\cfg\\webveil\\bin\\y.cmd');
		expect(win('.\\y.cmd', file)).toBe('C:\\cfg\\webveil\\y.cmd');
		expect(win('..\\y.cmd', file)).toBe('C:\\cfg\\y.cmd');
		// Root-relative takes the config file's drive, never the cwd's.
		expect(win('\\tools\\y.exe', file)).toBe('C:\\tools\\y.exe');
	});

	it('refuses Windows-relative paths from env or code', () => {
		for (const value of [
			'bin\\y.cmd',
			'.\\y.cmd',
			'\\tools\\y.exe',
			'/tools/y.exe',
		])
			for (const source of [{layer: 'env'} as const, undefined])
				expect(() => win(value, source)).toThrow(
					/must be absolute or start with ~\//,
				);
	});

	it('refuses a drive-relative path (it names a per-drive cwd)', () => {
		for (const source of [file, {layer: 'env'} as const])
			expect(() => win('C:y.exe', source)).toThrow(TrustError);
	});

	it('expands ~ with either separator on win32', () => {
		expect(win('~\\bin\\y.exe', {layer: 'env'})).toBe(
			'C:\\Users\\u\\bin\\y.exe',
		);
		expect(win('~/bin/y.exe', {layer: 'env'})).toBe('C:\\Users\\u\\bin\\y.exe');
	});

	it('the custom backend routes a backslash command through the path rules on win32', async () => {
		writeJson(globalFile, {backend: 'custom', baseUrl: 'bin\\search.cmd'});
		const calls: string[] = [];
		const backend = createCustomBackend(
			resolveHere(),
			recordingSpawn(calls),
			'win32',
		);
		await backend.search('q', unusedHttp);
		expect(calls).toEqual([
			win32.resolve(dirname(globalFile), 'bin\\search.cmd'),
		]);
	});

	it('the custom backend refuses a relative backslash command from env on win32', async () => {
		const calls: string[] = [];
		const backend = createCustomBackend(
			resolveHere({WEBVEIL_BACKEND: 'custom', WEBVEIL_BASE_URL: '.\\y.cmd'}),
			recordingSpawn(calls),
			'win32',
		);
		await expect(backend.search('q', unusedHttp)).rejects.toThrow(
			/must be absolute or start with ~\//,
		);
		expect(calls).toEqual([]);
	});

	it('the custom backend keeps a backslash name a bare PATH lookup on POSIX', async () => {
		writeJson(globalFile, {backend: 'custom', baseUrl: 'no\\such-webveil-cmd'});
		const calls: string[] = [];
		const backend = createCustomBackend(
			resolveHere(),
			recordingSpawn(calls),
			'linux',
		);
		await expect(backend.search('q', unusedHttp)).rejects.toThrow(
			/not found in any absolute PATH entry/,
		);
		expect(calls).toEqual([]);
	});
});
