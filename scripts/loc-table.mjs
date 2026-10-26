#!/usr/bin/env node
// Regenerates the LOC column of the README "Size discipline" table from the
// real line counts of the source files, so it cannot drift.
//
//   node scripts/loc-table.mjs          rewrite README.md (`pnpm loc`)
//   node scripts/loc-table.mjs --check  exit 1 when README.md is stale
//                                       (`pnpm loc:check`)
//
// The webveil test suite (`test/loc-table.test.ts`) runs the same check on
// this repository, so the verify gate (`pnpm test`) fails on a stale table.
//
// What is authored and what is generated: each `### \`packages/<name>\``
// section holds one table of `| module | LOC | target |` rows. The module cell
// (path plus an optional `(label)`), the target and the row order are authored
// and kept. The LOC cell, the `**subtotal**` row (where a table has one) and
// the `**Total own source: N LOC**` line are generated. A source file with no
// row gets one appended (before the subtotal) with target `-`; a row whose
// file no longer exists is an error, in both modes, since deleting the row is
// a human edit (its label and target may belong to a renamed file).
//
// Recorded decisions (task loc-table-generated):
// - LOC is the plain line count of the file (what `wc -l` reports, blank and
//   comment lines included), the definition the README header gives ("the
//   actual line count"). Every row that was correct before this task already
//   used it (trust.ts 230, pi-webveil index.ts 246); the stale rows were stale
//   counts, not a different metric. Alternative considered: non-blank lines,
//   rejected because it would silently re-mean the header.
// - A "source file" is every file under `packages/*/src`, whatever its
//   extension. A package with source files but no section is an error: its
//   heading and table are authored, not generated.
// - The table is re-aligned the way prettier aligns Markdown tables, so the
//   generated text reads like the authored text (`*.md` is prettier-ignored
//   here, so this is cosmetic, not a gate).
// - The gate runs through the test suite, like `scripts/text-rules.mjs`,
//   rather than as a new step in `dorfl.json` / the CI workflow: one gate
//   definition, already shared by both. Alternative considered: prefixing the
//   verify command with `pnpm loc:check`, rejected as a second place to keep
//   in sync.
// - Dependency-free on purpose: the searchcast repo has its own copy of the
//   idea, not a shared package.

import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SECTION_HEADING = '## Size discipline';
const PACKAGE_HEADING = /^### `packages\/([^`]+)`/;
const TOTAL_PATTERN = /\*\*Total own source: \d+ LOC\*\*/;
const SUBTOTAL_CELL = '**subtotal**';

/** Line count of a text, as `wc -l` would report it for a newline-ended file. */
export function countLines(text) {
	if (text === '') return 0;
	const n = text.split('\n').length;
	return text.endsWith('\n') ? n - 1 : n;
}

/** Repo-relative-to-package paths (`src/...`) of every file under `dir`. */
function walk(dir, prefix) {
	const out = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const rel = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
		else if (entry.isFile()) out.push(rel);
	}
	return out;
}

/** `Map<package, Map<'src/...', lines>>` for every `packages/*\/src` file. */
export function measureSources(root = repoRoot) {
	const out = new Map();
	const packagesDir = join(root, 'packages');
	if (!existsSync(packagesDir)) return out;
	for (const pkg of readdirSync(packagesDir, {withFileTypes: true})) {
		if (!pkg.isDirectory()) continue;
		const src = join(packagesDir, pkg.name, 'src');
		if (!existsSync(src)) continue;
		const files = new Map();
		for (const rel of walk(src, 'src').sort())
			files.set(
				rel,
				countLines(readFileSync(join(packagesDir, pkg.name, rel), 'utf8')),
			);
		out.set(pkg.name, files);
	}
	return out;
}

function splitRow(line) {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((c) => c.trim());
}

/** The file path of a module cell: `src/core/trust.ts (exec. settings)` -> `src/core/trust.ts`. */
function cellPath(cell) {
	return cell.split(/\s+/)[0];
}

/** Re-render table rows aligned the way prettier does. */
function renderTable(header, aligns, rows) {
	const widths = header.map((h, i) =>
		Math.max(3, h.length, ...rows.map((r) => (r[i] ?? '').length)),
	);
	const pad = (text, i) =>
		aligns[i] === 'right'
			? text.padStart(widths[i])
			: aligns[i] === 'center'
				? text
						.padStart(text.length + Math.floor((widths[i] - text.length) / 2))
						.padEnd(widths[i])
				: text.padEnd(widths[i]);
	const line = (cells) => `| ${cells.map(pad).join(' | ')} |`;
	const delimiter = aligns.map((a, i) =>
		a === 'right'
			? `${'-'.repeat(widths[i] - 1)}:`
			: a === 'center'
				? `:${'-'.repeat(widths[i] - 2)}:`
				: a === 'left'
					? `:${'-'.repeat(widths[i] - 1)}`
					: '-'.repeat(widths[i]),
	);
	return [line(header), `| ${delimiter.join(' | ')} |`, ...rows.map(line)];
}

function parseAlign(cell) {
	const left = cell.startsWith(':');
	const right = cell.endsWith(':');
	return left && right ? 'center' : right ? 'right' : left ? 'left' : 'none';
}

/**
 * The README text with the LOC column, subtotals and total regenerated from
 * `sources` (see `measureSources`). Throws when a row names a missing file,
 * when a package has source files but no section, or when the section or the
 * total line is absent.
 */
export function updateLocTable(readme, sources) {
	const lines = readme.split('\n');
	const start = lines.findIndex((l) => l.startsWith(SECTION_HEADING));
	if (start < 0) throw new Error(`README has no "${SECTION_HEADING}" section`);
	let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
	if (end < 0) end = lines.length;

	const errors = [];
	const seen = new Set();
	let total = 0;
	let pkg = null;
	for (let i = start + 1; i < end; i++) {
		const heading = lines[i].match(PACKAGE_HEADING);
		if (heading) {
			pkg = heading[1];
			continue;
		}
		if (!pkg || !lines[i].trim().startsWith('|')) continue;

		// A table: header, delimiter, rows, up to the first non-table line.
		let j = i;
		while (j < end && lines[j].trim().startsWith('|')) j++;
		const header = splitRow(lines[i]);
		const aligns = splitRow(lines[i + 1]).map(parseAlign);
		const rows = lines.slice(i + 2, j).map(splitRow);
		const files = sources.get(pkg) ?? new Map();
		seen.add(pkg);

		let subtotal = 0;
		let subtotalRow = null;
		const body = [];
		for (const row of rows) {
			if (row[0] === SUBTOTAL_CELL) {
				subtotalRow = row;
				continue;
			}
			const path = cellPath(row[0]);
			const loc = files.get(path);
			if (loc === undefined) {
				errors.push(
					`packages/${pkg}/${path}: listed in the README LOC table but does not exist`,
				);
				body.push(row);
				continue;
			}
			body.push([row[0], String(loc), ...row.slice(2)]);
			subtotal += loc;
		}
		const listed = new Set(rows.map((r) => cellPath(r[0])));
		for (const [path, loc] of files) {
			if (listed.has(path)) continue;
			body.push([path, String(loc), '-']);
			subtotal += loc;
		}
		if (subtotalRow)
			body.push([SUBTOTAL_CELL, String(subtotal), ...subtotalRow.slice(2)]);
		total += subtotal;

		const rendered = renderTable(header, aligns, body);
		lines.splice(i, j - i, ...rendered);
		end += rendered.length - (j - i);
		i += rendered.length - 1;
		pkg = null;
	}

	for (const [name, files] of sources)
		if (files.size > 0 && !seen.has(name))
			errors.push(
				`packages/${name}: has source files but no "### \`packages/${name}\`" table in the README`,
			);

	const totalAt = lines.findIndex(
		(l, i) => i > start && i < end && TOTAL_PATTERN.test(l),
	);
	if (totalAt < 0)
		errors.push('README has no "**Total own source: N LOC**" line');
	else
		lines[totalAt] = lines[totalAt].replace(
			TOTAL_PATTERN,
			`**Total own source: ${total} LOC**`,
		);

	if (errors.length > 0) throw new Error(errors.join('\n'));
	return lines.join('\n');
}

/**
 * Run the script against `root`: rewrite `README.md`, or with `--check` only
 * compare. Returns the exit code; messages go to `log` / `error`.
 */
export function main(
	argv,
	root = repoRoot,
	{log = console.log, error = console.error} = {},
) {
	const check = argv.includes('--check');
	const path = join(root, 'README.md');
	const current = readFileSync(path, 'utf8');
	let next;
	try {
		next = updateLocTable(current, measureSources(root));
	} catch (e) {
		error(e.message);
		return 1;
	}
	if (next === current) {
		log('README LOC table: up to date');
		return 0;
	}
	if (check) {
		error('README LOC table is stale: run `pnpm loc` to regenerate it.');
		return 1;
	}
	writeFileSync(path, next);
	log('README LOC table: updated');
	return 0;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	process.exit(main(process.argv.slice(2)));
