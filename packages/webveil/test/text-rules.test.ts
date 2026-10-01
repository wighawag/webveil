import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
// @ts-expect-error - plain .mjs script, no types
import {
	APPROVED_ENGINES,
	EM_DASH,
	ENGINE_DENYLIST,
	SELF,
	checkRepo,
	findViolations,
	formatViolations,
} from '../../../scripts/text-rules.mjs';

// The fixtures build the forbidden text from the script's own constants, so
// this file never contains an em dash or an engine name itself.
const engine: string = ENGINE_DENYLIST[0];

describe('text rules: findViolations', () => {
	it('flags an em dash', () => {
		expect(findViolations('README.md', `one\nfoo ${EM_DASH} bar`)).toEqual([
			{path: 'README.md', line: 2, rule: 'em-dash', match: EM_DASH},
		]);
	});

	it('flags every denied engine name, case-insensitively', () => {
		for (const name of ENGINE_DENYLIST as string[]) {
			const upper = name.toUpperCase();
			expect(
				findViolations('src/a.ts', `// ask ${upper} first`).map((v) => v.rule),
			).toEqual(['engine-name']);
		}
	});

	it('matches whole words only', () => {
		expect(findViolations('a.md', `com${engine}ed, ${engine}s`)).toEqual([]);
		expect(findViolations('a.md', `"${engine}", ${engine}.`)).toHaveLength(2);
	});

	it('allows the two approved engines and placeholders', () => {
		const text = `${(APPROVED_ENGINES as string[]).join(', ')}, engine-a, SearXNG`;
		expect(findViolations('README.md', text)).toEqual([]);
	});

	it('exempts work/ and every CHANGELOG.md', () => {
		const text = `${engine} ${EM_DASH}`;
		for (const path of [
			'work/notes/x.md',
			'CHANGELOG.md',
			'packages/webveil/CHANGELOG.md',
		])
			expect(findViolations(path, text)).toEqual([]);
		expect(findViolations('docs/CHANGELOG.md.bak', text)).toHaveLength(2);
	});

	it('exempts the denylist file from the engine rule only', () => {
		expect(findViolations(SELF, engine)).toEqual([]);
		expect(findViolations(SELF, EM_DASH)).toHaveLength(1);
	});
});

describe('text rules: checkRepo on a fixture repo', () => {
	let repo: string;
	const write = (path: string, text: string | Buffer) => {
		mkdirSync(dirname(join(repo, path)), {recursive: true});
		writeFileSync(join(repo, path), text);
	};

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'webveil-text-rules-'));
		execFileSync('git', ['init', '-q'], {cwd: repo});
	});
	afterEach(() => rmSync(repo, {recursive: true, force: true}));

	it('fails on tracked violations and ignores untracked, exempt and binary files', () => {
		write('README.md', `Search ${engine}.\nA ${EM_DASH} B\n`);
		write('ok.md', 'Mwmbl and Marginalia.\n');
		write('work/notes/n.md', `${engine} ${EM_DASH}\n`);
		write('pkg/CHANGELOG.md', `${engine} ${EM_DASH}\n`);
		write('icon.png', Buffer.from([0x89, 0, 0x2d, ...Buffer.from(engine)]));
		execFileSync('git', ['add', '-A'], {cwd: repo});
		write('untracked.md', `${engine}\n`);

		const violations = checkRepo(repo);
		expect(formatViolations(violations)).toBe(
			[
				`README.md:1: names a search engine (${engine})`,
				'README.md:2: em dash',
			].join('\n'),
		);
	});

	it('passes a clean fixture', () => {
		write('README.md', 'Search engine-a, then Mwmbl.\n');
		execFileSync('git', ['add', '-A'], {cwd: repo});
		expect(checkRepo(repo)).toEqual([]);
	});
});

describe('text rules: this repository', () => {
	it('has no em dash and names no unapproved search engine', () => {
		expect(formatViolations(checkRepo())).toBe('');
	});
});
