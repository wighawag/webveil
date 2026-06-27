import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	existsSync,
} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {resolveConfig} from '../src/core/config.js';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'webveil-config-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, '..'), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

describe('resolveConfig', () => {
	it('falls back to defaults when nothing is configured', () => {
		const cfg = resolveConfig({
			cwd: root,
			env: {},
			globalPath: join(root, 'nope', 'webveil.json'),
		});
		expect(cfg).toEqual({
			backend: 'searxng',
			baseUrl: 'http://127.0.0.1:8080',
			egress: {mode: 'direct'},
			fetchSize: 'm',
		});
	});

	it('resolves precedence env > project > global > defaults', () => {
		const globalPath = join(root, 'global', 'webveil.json');
		writeJson(globalPath, {
			backend: 'tavily-compat',
			baseUrl: 'http://global:1',
			fetchSize: 'l',
		});

		// project file overrides global baseUrl + backend, but not fetchSize
		writeJson(join(root, 'webveil.json'), {
			backend: 'searxng',
			baseUrl: 'http://project:2',
		});

		const cfg = resolveConfig({
			cwd: root,
			globalPath,
			env: {
				// env overrides project baseUrl (highest precedence)
				WEBVEIL_BASE_URL: 'http://env:3',
				WEBVEIL_EGRESS: 'socks5',
				WEBVEIL_EGRESS_URL: 'socks5://127.0.0.1:9050',
			},
		});

		expect(cfg.baseUrl).toBe('http://env:3'); // env wins
		expect(cfg.backend).toBe('searxng'); // project wins over global
		expect(cfg.fetchSize).toBe('l'); // only global set it
		expect(cfg.egress).toEqual({
			mode: 'socks5',
			url: 'socks5://127.0.0.1:9050',
		});
	});

	it('walks up from a nested cwd to find the nearest project file', () => {
		writeJson(join(root, 'webveil.json'), {baseUrl: 'http://near:1'});
		const nested = join(root, 'a', 'b', 'c');
		mkdirSync(nested, {recursive: true});

		const cfg = resolveConfig({
			cwd: nested,
			env: {},
			globalPath: join(root, 'no-global.json'),
		});
		expect(cfg.baseUrl).toBe('http://near:1');
	});

	it('prefers the nearest project file over an ancestor one', () => {
		writeJson(join(root, 'webveil.json'), {baseUrl: 'http://far:1'});
		const nested = join(root, 'a', 'b');
		writeJson(join(nested, 'webveil.json'), {baseUrl: 'http://near:2'});

		const cfg = resolveConfig({
			cwd: nested,
			env: {},
			globalPath: join(root, 'no-global.json'),
		});
		expect(cfg.baseUrl).toBe('http://near:2');
	});

	it('isolates the global path and never touches the real home dir', () => {
		const realGlobal = join(homedir(), '.config', 'webveil', 'config.json');
		const existedBefore = existsSync(realGlobal);

		const globalPath = join(root, 'global', 'webveil.json');
		writeJson(globalPath, {backend: 'from-temp-global'});

		const cfg = resolveConfig({
			cwd: root,
			env: {},
			globalPath,
		});
		expect(cfg.backend).toBe('from-temp-global');

		// the real global file must be unchanged by the run
		expect(existsSync(realGlobal)).toBe(existedBefore);
	});

	it('resolves the global file under $XDG_CONFIG_HOME when set', () => {
		const xdg = join(root, 'xdg');
		writeJson(join(xdg, 'webveil', 'config.json'), {backend: 'from-xdg'});

		const cfg = resolveConfig({
			cwd: root,
			env: {XDG_CONFIG_HOME: xdg},
			homeDir: join(root, 'unused-home'),
		});
		expect(cfg.backend).toBe('from-xdg');
	});

	it('falls back to <homeDir>/.config/webveil/config.json without XDG', () => {
		const home = join(root, 'home');
		writeJson(join(home, '.config', 'webveil', 'config.json'), {
			backend: 'from-home-config',
		});

		const cfg = resolveConfig({
			cwd: root,
			env: {},
			homeDir: home,
		});
		expect(cfg.backend).toBe('from-home-config');
	});
});
