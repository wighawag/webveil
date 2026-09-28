// trust — the ONE place that decides whether an executable setting may be used.
// Config is discovered by walking up from the cwd (docs/adr/0002), so a
// `webveil.json` in any cloned repository is read automatically; a setting that
// makes webveil run code (the `custom` backend command today; serpcast code
// recipes, the libcurl path, searchcast browser paths and args later) is
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
