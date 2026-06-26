import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	existsSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// @ts-expect-error - plain .mjs script, no types
import {
	copyPublishAssets,
	repoRoot,
	PUBLISH_ASSETS,
} from '../../../scripts/copy-publish-assets.mjs';

// Build a throwaway "repo" with root README.md + LICENSE and a package dir
// inside it, so we never touch the real repo or anything global.
let fakeRepo: string;

beforeEach(() => {
	fakeRepo = mkdtempSync(join(tmpdir(), 'webveil-copy-'));
	writeFileSync(join(fakeRepo, 'README.md'), '# root readme', 'utf8');
	writeFileSync(join(fakeRepo, 'LICENSE'), 'license text', 'utf8');
});

afterEach(() => {
	rmSync(fakeRepo, {recursive: true, force: true});
});

describe('copyPublishAssets', () => {
	it('copies README.md and LICENSE into the package dir', () => {
		const pkg = join(fakeRepo, 'packages', 'webveil');
		mkdirSync(pkg, {recursive: true});

		const written = copyPublishAssets({packageDir: pkg, root: fakeRepo});

		expect(written.sort()).toEqual(
			[join(pkg, 'README.md'), join(pkg, 'LICENSE')].sort(),
		);
		expect(readFileSync(join(pkg, 'README.md'), 'utf8')).toBe('# root readme');
		expect(readFileSync(join(pkg, 'LICENSE'), 'utf8')).toBe('license text');
		expect(PUBLISH_ASSETS).toEqual(['README.md', 'LICENSE']);
	});

	it('only writes inside the repo root, never to a shared/global location', () => {
		const pkg = join(fakeRepo, 'packages', 'pi-webveil');
		mkdirSync(pkg, {recursive: true});

		const written = copyPublishAssets({packageDir: pkg, root: fakeRepo});

		const root = resolve(fakeRepo);
		for (const dest of written) {
			expect(resolve(dest).startsWith(root)).toBe(true);
		}

		// Nothing was created outside the fake repo root.
		expect(existsSync(join(dirname(fakeRepo), 'README.md'))).toBe(false);
	});

	it('refuses to write outside the repo root', () => {
		const outside = mkdtempSync(join(tmpdir(), 'webveil-outside-'));
		try {
			expect(() =>
				copyPublishAssets({packageDir: outside, root: fakeRepo}),
			).toThrow(/outside the repo/);
			expect(existsSync(join(outside, 'README.md'))).toBe(false);
		} finally {
			rmSync(outside, {recursive: true, force: true});
		}
	});

	it('fails loud (without writing) when a source asset is missing', () => {
		const emptyRepo = mkdtempSync(join(tmpdir(), 'webveil-empty-'));
		const pkg = join(emptyRepo, 'packages', 'webveil');
		mkdirSync(pkg, {recursive: true});
		try {
			expect(() =>
				copyPublishAssets({packageDir: pkg, root: emptyRepo}),
			).toThrow(/source asset not found/);
			expect(existsSync(join(pkg, 'README.md'))).toBe(false);
		} finally {
			rmSync(emptyRepo, {recursive: true, force: true});
		}
	});

	it('resolves the real repo root to the directory holding root README.md', () => {
		const root = repoRoot();
		// The real repo root must be the parent of this test file's package's
		// package dir, and carry the root README the script copies.
		const here = dirname(fileURLToPath(import.meta.url));
		const expectedRoot = resolve(here, '..', '..', '..');
		expect(resolve(root)).toBe(expectedRoot);
		expect(existsSync(join(root, 'README.md'))).toBe(true);
	});
});
