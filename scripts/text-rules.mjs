#!/usr/bin/env node
// Text rules for the public repo, checked over every tracked file:
//
//   1. No em dash (U+2014) anywhere.
//   2. No real search engine named, except the two bundled default engines
//      (Mwmbl and Marginalia). Examples use placeholders such as `engine-a`.
//
// `work/` (notes, task records: history) and every `CHANGELOG.md` (release
// history) are exempt, as is this file from rule 2, since it has to spell the
// names it denies. Run `node scripts/text-rules.mjs` for a report; the webveil
// test suite (`test/text-rules.test.ts`) runs the same check, so the gate
// enforces it.
//
// Recorded decisions (task engine-neutral-no-em-dashes):
// - The denylist lives here, once. It lists mainstream web search engines by
//   their distinctive names, matched case-insensitively on word boundaries, so
//   `combining` does not match `bing`. `brave` is listed even though it is an
//   English word: a false positive costs one rephrase, a miss names an engine.
// - Names that are part of webveil's public interface stay allowed: the
//   `tavily-compat` backend (an API shape any provider can implement), SearXNG
//   (metasearch software, not an engine) and Ollama (whose tool names
//   pi-webveil mirrors). Renaming them would break configs; they are not on
//   the list. Alternative considered: denying `tavily` too, rejected for that
//   reason.
// - A file is skipped as binary when it holds a NUL byte (the png and ttf
//   assets); svg and every other text file is checked.

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The em dash, written as an escape so this file does not contain one. */
export const EM_DASH = '\u2014';

/** Search engines the repo may name: the bundled default engines. */
export const APPROVED_ENGINES = ['mwmbl', 'marginalia'];

/** Search engines the repo must not name (see the decisions above). */
export const ENGINE_DENYLIST = [
	'google',
	'bing',
	'duckduckgo',
	'ddg',
	'brave',
	'yahoo',
	'yandex',
	'baidu',
	'qwant',
	'startpage',
	'ecosia',
	'mojeek',
	'kagi',
	'swisscows',
	'presearch',
	'metager',
	'naver',
	'seznam',
	'sogou',
];

/** This file's repo-relative path: exempt from the engine rule only. */
export const SELF = 'scripts/text-rules.mjs';

const ENGINE_PATTERN = new RegExp(`\\b(${ENGINE_DENYLIST.join('|')})\\b`, 'gi');

/** True when a repo-relative path is history the rules do not apply to. */
export function isExempt(path) {
	return (
		path.startsWith('work/') ||
		path === 'CHANGELOG.md' ||
		path.endsWith('/CHANGELOG.md')
	);
}

/**
 * Violations in one file's text: `{path, line, rule, match}` per hit, where
 * `rule` is `em-dash` or `engine-name`.
 */
export function findViolations(path, text) {
	const out = [];
	if (isExempt(path)) return out;
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.includes(EM_DASH))
			out.push({path, line: i + 1, rule: 'em-dash', match: EM_DASH});
		if (path === SELF) continue;
		for (const m of line.matchAll(ENGINE_PATTERN))
			out.push({path, line: i + 1, rule: 'engine-name', match: m[0]});
	}
	return out;
}

/** Repo-relative paths of every tracked file under `root`. */
export function trackedFiles(root = repoRoot) {
	return execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'})
		.split('\0')
		.filter(Boolean);
}

/** Every violation across the tracked text files under `root`. */
export function checkRepo(root = repoRoot) {
	const out = [];
	for (const path of trackedFiles(root)) {
		if (isExempt(path)) continue;
		let buf;
		try {
			buf = readFileSync(join(root, path));
		} catch {
			continue; // tracked but deleted in the working tree
		}
		if (buf.includes(0)) continue; // binary
		out.push(...findViolations(path, buf.toString('utf8')));
	}
	return out;
}

/** One line per violation, for a report or a test failure message. */
export function formatViolations(violations) {
	return violations
		.map((v) =>
			v.rule === 'em-dash'
				? `${v.path}:${v.line}: em dash`
				: `${v.path}:${v.line}: names a search engine (${v.match})`,
		)
		.join('\n');
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const violations = checkRepo();
	if (violations.length > 0) {
		console.error(formatViolations(violations));
		console.error(`\n${violations.length} text rule violation(s).`);
		process.exit(1);
	}
	console.log('text rules: clean');
}
