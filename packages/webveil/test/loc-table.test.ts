import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
// @ts-expect-error - plain .mjs script, no types
import {
	countLines,
	main,
	updateLocTable,
	measureSources,
} from '../../../scripts/loc-table.mjs';

const README = (aLoc: number, bLoc: number, total: number) =>
	[
		'# demo',
		'',
		'## Size discipline (per-module LOC)',
		'',
		'### `packages/core`',
		'',
		'| module         | LOC | target |',
		'| -------------- | --: | -----: |',
		`| src/b.ts (two) | ${bLoc} |    ~10 |`,
		`| src/a.ts       | ${aLoc} |      - |`,
		`| **subtotal**   | ${aLoc + bLoc} |        |`,
		'',
		'### `packages/ext`',
		'',
		'| module       | LOC | target |',
		'| ------------ | --: | -----: |',
		'| src/index.ts | 1 |    ~90 |',
		'',
		`**Total own source: ${total} LOC** (excluding deps).`,
		'',
		'## Develop',
		'',
		'| not | a | LOC table |',
		'',
	].join('\n');

describe('loc table: countLines', () => {
	it('counts lines like wc -l, blank lines included', () => {
		expect(countLines('')).toBe(0);
		expect(countLines('a\n\nb\n')).toBe(3);
		expect(countLines('a\nb')).toBe(2);
	});
});

describe('loc table: on a fixture repo', () => {
	let root: string;
	const write = (path: string, text: string) => {
		mkdirSync(dirname(join(root, path)), {recursive: true});
		writeFileSync(join(root, path), text);
	};
	const readme = () => readFileSync(join(root, 'README.md'), 'utf8');
	const quiet = {log: () => {}, error: (m: string) => errors.push(m)};
	let errors: string[];

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'webveil-loc-table-'));
		errors = [];
		write('packages/core/src/a.ts', 'a\n\nb\n'); // 3
		write('packages/core/src/b.ts', 'x\n'.repeat(12)); // 12
		write('packages/ext/src/index.ts', 'y\n'.repeat(5)); // 5
	});
	afterEach(() => rmSync(root, {recursive: true, force: true}));

	it('check fails on a stale table, and passes after a rewrite', () => {
		write('README.md', README(1, 1, 3));
		expect(main(['--check'], root, quiet)).toBe(1);
		expect(errors.join('\n')).toMatch(/stale: run `pnpm loc`/);

		expect(main([], root, quiet)).toBe(0);
		expect(readme()).toBe(
			[
				'# demo',
				'',
				'## Size discipline (per-module LOC)',
				'',
				'### `packages/core`',
				'',
				'| module         | LOC | target |',
				'| -------------- | --: | -----: |',
				'| src/b.ts (two) |  12 |    ~10 |',
				'| src/a.ts       |   3 |      - |',
				'| **subtotal**   |  15 |        |',
				'',
				'### `packages/ext`',
				'',
				'| module       | LOC | target |',
				'| ------------ | --: | -----: |',
				'| src/index.ts |   5 |    ~90 |',
				'',
				'**Total own source: 20 LOC** (excluding deps).',
				'',
				'## Develop',
				'',
				'| not | a | LOC table |',
				'',
			].join('\n'),
		);
		expect(main(['--check'], root, quiet)).toBe(0);
	});

	it('leaves a fresh table untouched', () => {
		write('README.md', README(3, 12, 20));
		const before = readme();
		const fixed = updateLocTable(before, measureSources(root));
		write('README.md', fixed);
		expect(main(['--check'], root, quiet)).toBe(0);
		expect(main([], root, quiet)).toBe(0);
		expect(readme()).toBe(fixed);
	});

	it('fails, in both modes, on a row whose file no longer exists', () => {
		write('README.md', README(3, 12, 20));
		rmSync(join(root, 'packages/core/src/b.ts'));
		const before = readme();
		expect(main([], root, quiet)).toBe(1);
		expect(main(['--check'], root, quiet)).toBe(1);
		expect(errors[0]).toBe(
			'packages/core/src/b.ts: listed in the README LOC table but does not exist',
		);
		expect(readme()).toBe(before);
	});

	it('adds a row for a new source file, before the subtotal', () => {
		write('README.md', README(3, 12, 20));
		write('packages/core/src/backends/new-one.ts', 'z\n'.repeat(7));
		expect(main(['--check'], root, quiet)).toBe(1);
		expect(main([], root, quiet)).toBe(0);
		const text = readme();
		expect(text).toContain(
			[
				'| module                  | LOC | target |',
				'| ----------------------- | --: | -----: |',
				'| src/b.ts (two)          |  12 |    ~10 |',
				'| src/a.ts                |   3 |      - |',
				'| src/backends/new-one.ts |   7 |      - |',
				'| **subtotal**            |  22 |        |',
			].join('\n'),
		);
		expect(text).toContain('**Total own source: 27 LOC**');
		expect(main(['--check'], root, quiet)).toBe(0);
	});

	it('fails on a package with source files but no table', () => {
		write('README.md', README(3, 12, 20));
		write('packages/third/src/index.ts', 'q\n');
		expect(main([], root, quiet)).toBe(1);
		expect(errors[0]).toMatch(/packages\/third: has source files but no/);
	});
});

describe('loc table: this repository', () => {
	it('README LOC table matches the source files (run `pnpm loc` to fix)', () => {
		const errors: string[] = [];
		expect(
			main(['--check'], undefined, {
				log: () => {},
				error: (m: string) => errors.push(m),
			}),
			errors.join('\n'),
		).toBe(0);
	});
});
