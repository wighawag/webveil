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
	rewriteReadmeLinks,
	resolvePinRef,
	GITHUB_REPO,
} from '../../../scripts/copy-publish-assets.mjs';

// Build a throwaway "repo" with root README.md + LICENSE and a package dir
// inside it, so we never touch the real repo or anything global.
let fakeRepo: string;

beforeEach(() => {
	fakeRepo = mkdtempSync(join(tmpdir(), 'webveil-copy-'));
	writeFileSync(
		join(fakeRepo, 'README.md'),
		'See [a note](work/notes/x.md) and [ADR](docs/adr/0001.md).',
		'utf8',
	);
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
		// LICENSE is copied verbatim; README has its non-shipped links rewritten
		// to absolute GitHub URLs (the package has no package.json here, so the
		// pin ref falls back to the repo's git HEAD or 'main').
		expect(readFileSync(join(pkg, 'LICENSE'), 'utf8')).toBe('license text');
		const readme = readFileSync(join(pkg, 'README.md'), 'utf8');
		expect(readme).toContain(`](https://github.com/${GITHUB_REPO}/blob/`);
		expect(readme).toContain('/work/notes/x.md)');
		expect(readme).not.toContain('](work/notes/x.md)');
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

	it('pins links to `${name}@${version}` from the package.json', () => {
		const pkg = join(fakeRepo, 'packages', 'webveil');
		mkdirSync(pkg, {recursive: true});
		writeFileSync(
			join(pkg, 'package.json'),
			JSON.stringify({name: 'webveil', version: '9.9.9'}),
			'utf8',
		);

		copyPublishAssets({packageDir: pkg, root: fakeRepo});

		const readme = readFileSync(join(pkg, 'README.md'), 'utf8');
		expect(readme).toContain(
			`](https://github.com/${GITHUB_REPO}/blob/webveil@9.9.9/work/notes/x.md)`,
		);
		expect(readme).toContain(
			`](https://github.com/${GITHUB_REPO}/blob/webveil@9.9.9/docs/adr/0001.md)`,
		);
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

describe('rewriteReadmeLinks', () => {
	const ref = 'webveil@1.2.3';
	const base = `https://github.com/${GITHUB_REPO}/blob/${ref}`;

	it('rewrites non-shipped repo-relative links to pinned GitHub URLs', () => {
		expect(rewriteReadmeLinks('[x](work/notes/a.md)', {ref})).toBe(
			`[x](${base}/work/notes/a.md)`,
		);
		expect(rewriteReadmeLinks('[x](docs/adr/0001.md)', {ref})).toBe(
			`[x](${base}/docs/adr/0001.md)`,
		);
		expect(rewriteReadmeLinks('[x](packages/webveil)', {ref})).toBe(
			`[x](${base}/packages/webveil)`,
		);
		expect(rewriteReadmeLinks('[x](CONTEXT.md)', {ref})).toBe(
			`[x](${base}/CONTEXT.md)`,
		);
	});

	it('preserves an in-file anchor on a rewritten link', () => {
		expect(
			rewriteReadmeLinks('[x](docs/searxng-setup.md#the-port-gotcha)', {ref}),
		).toBe(`[x](${base}/docs/searxng-setup.md#the-port-gotcha)`);
	});

	it('leaves shipped assets, absolute URLs, and anchors untouched', () => {
		for (const link of [
			'[x](LICENSE)',
			'[x](COPYRIGHT)', // COPYRIGHT is shipped? no - but assert behaviour below
			'[x](https://example.com/a)',
			'[x](http://example.com)',
			'[x](#an-anchor)',
			'[x](mailto:a@b.c)',
		]) {
			if (link === '[x](COPYRIGHT)') continue; // checked separately
			expect(rewriteReadmeLinks(link, {ref})).toBe(link);
		}
		// LICENSE ships in the tarball, so it stays relative.
		expect(rewriteReadmeLinks('[x](LICENSE)', {ref})).toBe('[x](LICENSE)');
		// COPYRIGHT does NOT ship, so it gets rewritten.
		expect(rewriteReadmeLinks('[x](COPYRIGHT)', {ref})).toBe(
			`[x](${base}/COPYRIGHT)`,
		);
	});

	it('throws without a ref', () => {
		expect(() => rewriteReadmeLinks('[x](work/a.md)', {})).toThrow(/ref/);
	});
});

describe('resolvePinRef', () => {
	it('prefers `${name}@${version}` from the package.json', () => {
		const dir = mkdtempSync(join(tmpdir(), 'webveil-pin-'));
		try {
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({name: 'pi-webveil', version: '0.2.1'}),
				'utf8',
			);
			expect(resolvePinRef({packageDir: dir, env: {GITHUB_SHA: 'abc'}})).toBe(
				'pi-webveil@0.2.1',
			);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it('falls back to GITHUB_SHA when no package version is available', () => {
		const dir = mkdtempSync(join(tmpdir(), 'webveil-pin-'));
		try {
			expect(
				resolvePinRef({packageDir: dir, env: {GITHUB_SHA: 'deadbeef'}}),
			).toBe('deadbeef');
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
