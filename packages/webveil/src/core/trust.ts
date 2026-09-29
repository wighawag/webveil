// trust — the ONE place that decides whether an executable setting may be used.
// Config is discovered by walking up from the cwd (docs/adr/0002), so a
// `webveil.json` in any cloned repository is read automatically; a setting that
// makes webveil run code (the `custom` backend command, serpcast code recipes,
// the libcurl path, searchcast's chrome and xvfb paths and chrome args) is
// therefore accepted only from env or the global config (docs/adr/0004).
//
// The check runs where the setting is USED (by the backend that needs it), not
// in resolution, so a project config naming an executable setting a given call
// does not use (e.g. `web_fetch`) never blocks that call.
//
// Paths in executable settings resolve through `resolveExecutablePath`, which
// never consults the cwd (a hostile repository controls it): `~` is the home
// directory, a relative path is relative to the config file that set it, and a
// value with no file (env, defaults, code) must be absolute or `~`-prefixed.
//
// Recorded decisions (task config-trust-layers):
// - Provenance travels ON the resolved Config (a non-enumerable symbol, see
//   layers.ts) rather than as a second return value, so `search`/`fetch`, their
//   injectable deps and `getBackend(name, config)` keep their signatures and a
//   backend factory sees it without new plumbing. Alternative considered: a
//   `{config, provenance}` result threaded through search/fetch/registry.
// - A config with NO provenance (built in code) is trusted: code is already
//   running and no file supplied it. For paths it has no directory, so it is
//   treated like env (absolute or `~/` only). Values from `defaults` likewise.
// - Only `~` and `~/...` expand, to `os.homedir()` (as a shell does); `~user`
//   is not expanded and resolves as a relative path.
//
// Recorded decisions (task custom-command-path-lookup-skips-relative-entries):
// - A bare command name (no slash) is looked up by webveil itself through
//   `resolveCommandOnPath`, not by `spawn`: `spawn` would honour an empty, `.`
//   or relative PATH entry against the inherited cwd. Only absolute PATH entries
//   are searched and the absolute match is what gets spawned. Alternative
//   considered: spawning with `cwd` set to a neutral directory, rejected because
//   the command would then run somewhere else than it does today.
// - The PATH searched is the webveil process's own `PATH` (what `spawn` would
//   have used), not a config value. No match is a `TrustError` (like every other
//   refused executable), raised before anything is spawned.
// - "Executable" means a regular file (symlinks followed) with an execute bit
//   for this process (`X_OK`); on Windows every regular file counts and the
//   name is tried with each PATHEXT extension (default `.COM;.EXE;.BAT;.CMD`),
//   and also as-is when it already ends in one of them.

import {accessSync, constants, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {configProvenance} from './layers.js';
import type {ConfigSource, Provenance} from './layers.js';

/** A refused executable setting (untrusted layer, or an unresolvable path). */
export class TrustError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TrustError';
	}
}

/** The source of `keyPath` in `config`, or `undefined` for a code-built config. */
export function sourceOf(
	config: object,
	keyPath: string,
): ConfigSource | undefined {
	return configProvenance(config)?.[keyPath];
}

/**
 * Refuse any of `keyPaths` (or any leaf nested under one) whose value came from
 * a project `webveil.json`. A config built in code has no provenance and is
 * trusted: code is already running, no file supplied it.
 */
export function assertTrusted(
	config: object,
	keyPaths: string[],
	provenance: Provenance | undefined = configProvenance(config),
): void {
	if (!provenance) return;
	for (const [path, source] of Object.entries(provenance)) {
		if (source.layer !== 'project') continue;
		const key = keyPaths.find((k) => path === k || path.startsWith(`${k}.`));
		if (key === undefined) continue;
		throw new TrustError(
			`webveil: refusing \`${path}\` from project config ${source.path}: it ` +
				'makes webveil run code, and a project webveil.json is read ' +
				'automatically from any checkout. Move it to the global config ' +
				'($XDG_CONFIG_HOME/webveil/config.json, default ' +
				'~/.config/webveil/config.json) or to env.',
		);
	}
}

/**
 * Resolve a path from an executable setting without ever touching the cwd.
 * `source` is where the value came from (`sourceOf`); `undefined` means code.
 */
export function resolveExecutablePath(
	value: string,
	source: ConfigSource | undefined,
	home: string = homedir(),
): string {
	if (value === '~' || value.startsWith('~/'))
		return join(home, value.slice(1));
	if (isAbsolute(value)) return value;
	if (source?.layer === 'global' || source?.layer === 'project')
		return resolve(dirname(source.path), value);
	throw new TrustError(
		`webveil: relative path '${value}' from ${source?.layer ?? 'code'} must ` +
			'be absolute or start with ~/ (it is never resolved against the cwd)',
	);
}

/** Environment and platform seams for `resolveCommandOnPath` (tests). */
export interface PathLookupOptions {
	env?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
}

function isExecutableFile(path: string, windows: boolean): boolean {
	try {
		if (!statSync(path).isFile()) return false;
		if (!windows) accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve a bare command name (no slash) to an absolute executable path by
 * walking PATH, skipping empty and non-absolute entries so the cwd (which a
 * cloned repository controls) is never searched. Throws a `TrustError` naming
 * the command when no absolute PATH entry holds it.
 */
export function resolveCommandOnPath(
	name: string,
	{env = process.env, platform = process.platform}: PathLookupOptions = {},
): string {
	const windows = platform === 'win32';
	const pathValue =
		env.PATH ??
		(windows
			? Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1]
			: undefined) ??
		'';
	const sep = windows ? ';' : ':';
	const dirs = pathValue.split(sep).filter((dir) => isAbsolute(dir));
	let candidates = [name];
	if (windows) {
		const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
			.split(';')
			.filter(Boolean);
		const hasExt = exts.some((ext) =>
			name.toLowerCase().endsWith(ext.toLowerCase()),
		);
		candidates = [...(hasExt ? [name] : []), ...exts.map((ext) => name + ext)];
	}
	for (const dir of dirs)
		for (const candidate of candidates) {
			const full = join(dir, candidate);
			if (isExecutableFile(full, windows)) return full;
		}
	throw new TrustError(
		`webveil: command '${name}' was not found in any absolute PATH entry ` +
			'(empty and relative PATH entries are ignored, so the cwd is never ' +
			'searched); set an absolute path or ~/ path instead',
	);
}
