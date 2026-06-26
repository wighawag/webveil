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
		writeJson(join(root, '.pi', 'webveil.json'), {
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
		writeJson(join(root, '.pi', 'webveil.json'), {baseUrl: 'http://near:1'});
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
		writeJson(join(root, '.pi', 'webveil.json'), {baseUrl: 'http://far:1'});
		const nested = join(root, 'a', 'b');
		writeJson(join(nested, '.pi', 'webveil.json'), {baseUrl: 'http://near:2'});

		const cfg = resolveConfig({
			cwd: nested,
			env: {},
			globalPath: join(root, 'no-global.json'),
		});
		expect(cfg.baseUrl).toBe('http://near:2');
	});

	it('isolates the global path and never touches the real home dir', () => {
		const realGlobal = join(homedir(), '.pi', 'agent', 'webveil.json');
		const existedBefore = existsSync(realGlobal);

		const globalPath = join(root, 'global', 'webveil.json');
		writeJson(globalPath, {backend: 'from-temp-global'});

		const cfg = resolveConfig({
			cwd: root,
			env: {},
			globalPath,
		});
		expect(cfg.backend).toBe('from-temp-global');

		// the real ~/.pi/agent/webveil.json must be unchanged by the run
		expect(existsSync(realGlobal)).toBe(existedBefore);
	});
});
