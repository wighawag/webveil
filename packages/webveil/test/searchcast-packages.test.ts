// webveil runs on searchcast's packages (searchcast's ADR 0005: `serpcast` is
// `searchcast` 0.2, `serpcast-recipe` is `@searchcast/recipe`, the browser
// runner is `@searchcast/browser`): no source file imports an old package, the
// manifest and the lockfile name none, and the browser peer is the new one.

import {describe, expect, it} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const repo = join(pkgDir, '..', '..');
const OLD = /^(serpcast|serpcast-recipe)(\/.*)?$/;

/** Every `.ts` file under `dir`. */
function sources(dir: string): string[] {
	return readdirSync(dir, {recursive: true, withFileTypes: true})
		.filter((e) => e.isFile() && e.name.endsWith('.ts'))
		.map((e) => join(e.parentPath, e.name));
}

/** Every module specifier of `text`: static, type-only, re-export, dynamic. */
function specifiers(text: string): string[] {
	return [
		...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
		...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
		...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
	].map((m) => m[1]!);
}

describe('webveil depends on searchcast, not serpcast', () => {
	it('imports no serpcast or serpcast-recipe module (src and test)', () => {
		const files = [
			...sources(join(pkgDir, 'src')),
			...sources(join(pkgDir, 'test')),
		];
		expect(files.length).toBeGreaterThan(10);
		const found = files.flatMap((file) =>
			specifiers(readFileSync(file, 'utf8'))
				.filter((spec) => OLD.test(spec))
				.map((spec) => `${file}: ${spec}`),
		);
		expect(found).toEqual([]);
		// ...and the check would see one: the real imports are found.
		const backend = readFileSync(
			join(pkgDir, 'src', 'core', 'backends', 'searchcast.ts'),
			'utf8',
		);
		expect(specifiers(backend)).toContain('searchcast');
		expect(specifiers(backend)).toContain('@searchcast/recipe/node');
	});

	it('declares searchcast and @searchcast/recipe, and @searchcast/browser as the optional peer', () => {
		const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
		const all = {
			...pkg.dependencies,
			...pkg.devDependencies,
			...pkg.peerDependencies,
			...pkg.optionalDependencies,
		};
		expect(Object.keys(all).filter((name) => OLD.test(name))).toEqual([]);
		expect(pkg.dependencies.searchcast).toBe('^0.4.0');
		expect(pkg.dependencies['@searchcast/recipe']).toBe('^0.1.0');
		expect(pkg.peerDependencies).toEqual({
			'@searchcast/browser': '>=0.1.0 <0.2.0',
		});
		expect(pkg.peerDependenciesMeta).toEqual({
			'@searchcast/browser': {optional: true},
		});
	});

	it('the lockfile has no serpcast or serpcast-recipe entry', () => {
		const lock = readFileSync(join(repo, 'pnpm-lock.yaml'), 'utf8');
		expect(lock).not.toMatch(/(^|[\s'"/])serpcast(-recipe)?@/m);
		expect(lock).not.toMatch(/^\s+serpcast(-recipe)?:/m);
		expect(lock).toMatch(/^\s+searchcast@0\.4\.\d+/m);
	});
});
