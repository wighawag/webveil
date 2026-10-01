// spellings: the `serpcast` spellings of webveil 0.10, accepted for one release
// with a warning. Every config layer (a config file's JSON, or the env) is
// rewritten to the `searchcast` spellings BEFORE the layers merge (config.ts),
// so the rest of webveil only ever sees one spelling: provenance records the
// new key path, the trust check (trust.ts) refuses a project-set
// `serpcast.codeRecipes` exactly as it refuses `searchcast.codeRecipes`, and
// the identity key (identity.ts) hashes the same section whichever spelling
// supplied it. A renamed key can therefore not become a way around a refusal:
// there is no second key to check.
//
// | old                                | new                                 |
// | `backend: "serpcast"`              | `backend: "searchcast"`             |
// | section `serpcast.*`               | `searchcast.*`                      |
// | `serpcast.searchcast.*`            | `searchcast.browser.*`              |
// | `fetchTransport: "serpcast"`       | `fetchTransport: "searchcast"`      |
// | `fetchSerpcast.*`                  | `fetchSearchcast.*`                 |
// | `WEBVEIL_SERPCAST_*`               | `WEBVEIL_SEARCHCAST_*`              |
// | `WEBVEIL_SERPCAST_SEARCHCAST_*`    | `WEBVEIL_SEARCHCAST_BROWSER_*`      |
// | `WEBVEIL_FETCH_SERPCAST_*`         | `WEBVEIL_FETCH_SEARCHCAST_*`        |
// | `WEBVEIL_BACKEND=serpcast`         | `WEBVEIL_BACKEND=searchcast`        |
// | engine name `searchcast:<recipe>`  | `browser:<recipe>`                  |
//
// Recorded decisions (task rename-serpcast-spellings):
// - The browser-runner subsection is renamed `browser` (`searchcast.browser.*`,
//   env `WEBVEIL_SEARCHCAST_BROWSER_*`), not `searchcast.searchcast.*`: the
//   runner is the `@searchcast/browser` package, and "searchcast" twice in a
//   row names nothing. The rename of that nested key is its own rule (a
//   `searchcast` key INSIDE the section is the old name of `browser`), so the
//   half-migrated forms `searchcast.searchcast.*` and
//   `WEBVEIL_SEARCHCAST_SEARCHCAST_*` (what a blind search-and-replace of
//   `serpcast` produces) are accepted with the same warning, instead of being
//   silently ignored. The browser ENGINE prefix `searchcast:<recipe>` in
//   `engines` is a value, unchanged (until task browser-engine-prefix, below).
// - One warning per spelling per layer: the section, the nested browser key,
//   `fetchSerpcast`, the `backend` value and the `fetchTransport` value each
//   warn once per file that uses them (naming the file, where the user edits);
//   the env variables warn once per old prefix, listing each variable with its
//   new name. The frontends deduplicate identical warnings (`reportDeprecations`).
// - Both spellings of the same setting in one layer is an error naming both,
//   never a silent pick. "The same setting" is a LEAF: `serpcast.libcurlPath`
//   beside `searchcast.engines` in one file merge (one section), whereas
//   `serpcast.engines` beside `searchcast.engines` fail. Object-valued keys
//   that are leaves for the merge (`decoyGuard`, layers.ts) are leaves here
//   too. Across layers there is nothing special: each layer is rewritten, then
//   the usual precedence applies to the rewritten setting. An env variable set
//   to the empty string counts as unset (as `readKeys` already treats it).
// - Warnings are DATA on the resolved config (`configDeprecations`, a
//   non-enumerable symbol like provenance), never printed by `resolveConfig`:
//   the caller decides where they go. `search`/`fetch` hand them to
//   `options.onWarning`, else print each once per process on stderr (the CLI,
//   the MCP server whose stdout is the protocol, and library callers);
//   pi-webveil passes its own sink; `webveil doctor` lists them as
//   `deprecations` (not a problem: doctor stays healthy, the old spelling
//   still works). Alternative considered: printing inside `resolveConfig`,
//   rejected because doctor and pi would then print to a terminal they do not
//   own.
//
// Recorded decisions (task browser-engine-prefix):
// - A browser engine is named `browser:<recipe>` (it was `searchcast:<recipe>`,
//   which, once the backend, its section and every HTTP engine were
//   "searchcast" too, no longer said "browser"). The old prefix is a VALUE,
//   so it is rewritten here, per layer, like the `backend` value: everything
//   downstream (the chain, doctor, unresponsiveEngines) sees `browser:` only.
//   There is no separate endpoint spelling: endpoint mode uses the same
//   engine names (backends/searchcast.ts).
// - The values rewritten are the engine names in `searchcast.engines` AND in
//   `searchcast.decoyGuard` (its list, `include` and `exclude`; env
//   `WEBVEIL_SEARCHCAST_DECOY_GUARD` and `_EXCLUDE`): the guard matches
//   engine names, and a name searchcast never sees is silently unguarded
//   (config.ts), so rewriting only the chain would silently drop a guard on
//   an old-spelled browser engine. Alternative considered: `engines` only, as
//   the task text names it, rejected for that silent drop.
// - One warning per layer for this spelling, listing every old name with its
//   key path (a file) or variable (env). Both prefixes naming the same recipe
//   in one list is an error naming both, never a silent dedupe.
// - Identity keys: the backend hashes `browser:` names in their old spelling
//   (`searchcastIdentityKey`), so a chain written either way keeps its state
//   partition and browser profile. What does restart: a browser engine's
//   COOLDOWN, which searchcast keys by engine name inside the partition; a
//   blocked browser engine may thus be tried once more after the upgrade.
//   Alternative considered: handing searchcast the old name, rejected because
//   `unresponsiveEngines` and the errors would then show a name the user no
//   longer writes.

import {WHOLE_KEYS} from './layers.js';

/** The engine-name prefix of a browser engine (backends/searchcast.ts). */
export const BROWSER_PREFIX = 'browser:';
/** Its webveil 0.12 spelling, accepted for one release (decisions above). */
export const OLD_BROWSER_PREFIX = 'searchcast:';

type Json = Record<string, unknown>;
type Env = Record<string, string | undefined>;

const NEXT = 'removed in the next minor release';

/** The warning for one deprecated spelling (`where`: a file path, or `env`). */
function warning(old: string, now: string, where: string): string {
	return `webveil: ${old} (${where}) is a deprecated spelling, ${NEXT}: use ${now} instead.`;
}

function conflict(a: string, b: string, where: string): Error {
	return new Error(
		`webveil: ${a} and ${b} are both set (${where}): they are two ` +
			`spellings of the same setting. Keep ${b} and remove ${a} ` +
			`(the old spelling is ${NEXT}).`,
	);
}

function isPlainObject(value: unknown): value is Json {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * `newValue` and `oldValue` merged leaf by leaf (sections merge, a leaf set in
 * both is a conflict naming both key paths). `path` is the new key path.
 */
function mergeStrict(
	newValue: unknown,
	oldValue: unknown,
	newPath: string,
	oldPath: string,
	where: string,
): unknown {
	if (newValue === undefined) return oldValue;
	if (oldValue === undefined) return newValue;
	if (
		!isPlainObject(newValue) ||
		!isPlainObject(oldValue) ||
		WHOLE_KEYS.has(newPath)
	)
		throw conflict(`\`${oldPath}\``, `\`${newPath}\``, where);
	const merged: Json = {...newValue};
	for (const key of Object.keys(oldValue)) {
		if (key === '__proto__') continue;
		Object.defineProperty(merged, key, {
			value: mergeStrict(
				newValue[key],
				oldValue[key],
				`${newPath}.${key}`,
				`${oldPath}.${key}`,
				where,
			),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return merged;
}

/**
 * `object[oldKey]` moved to `object[newKey]` (merged strictly when both are
 * set), with one warning. Returns `object` itself when `oldKey` is absent.
 */
function renameKey(
	object: Json,
	oldKey: string,
	newKey: string,
	paths: {old: string; new: string},
	where: string,
	warnings: string[],
): Json {
	if (!Object.hasOwn(object, oldKey)) return object;
	warnings.push(warning(`\`${paths.old}\``, `\`${paths.new}\``, where));
	const {[oldKey]: oldValue, ...rest} = object;
	return {
		...rest,
		[newKey]: mergeStrict(rest[newKey], oldValue, paths.new, paths.old, where),
	};
}

/** A section's nested browser key (`searchcast`, the old name) renamed `browser`. */
function renameBrowser(
	section: unknown,
	sectionName: string,
	where: string,
	warnings: string[],
): unknown {
	if (!isPlainObject(section)) return section;
	return renameKey(
		section,
		'searchcast',
		'browser',
		{old: `${sectionName}.searchcast`, new: 'searchcast.browser'},
		where,
		warnings,
	);
}

/** A value spelled `serpcast` (`backend`, `fetchTransport`) as `searchcast`. */
function renameValue(
	layer: Json,
	key: string,
	where: string,
	warnings: string[],
	shown: (value: string) => string = (value) => `\`${key}: "${value}"\``,
): Json {
	if (layer[key] !== 'serpcast') return layer;
	warnings.push(warning(shown('serpcast'), shown('searchcast'), where));
	return {...layer, [key]: 'searchcast'};
}

/** `name` in the new browser prefix when it uses the old one, else undefined. */
function renamedEngine(name: unknown): string | undefined {
	if (typeof name !== 'string' || !name.startsWith(OLD_BROWSER_PREFIX))
		return undefined;
	return BROWSER_PREFIX + name.slice(OLD_BROWSER_PREFIX.length);
}

/**
 * A list of engine names with every old browser prefix rewritten. `found`
 * receives `[old, new]` for each; throws when both prefixes name one recipe.
 * Anything that is not a list of strings is returned as is (validation
 * names it later).
 */
function renameEngineList(
	list: unknown,
	label: string,
	where: string,
	found: [string, string, string][],
): unknown {
	if (!Array.isArray(list)) return list;
	return list.map((name: unknown) => {
		const now = renamedEngine(name);
		if (now === undefined) return name;
		if (list.includes(now))
			throw new Error(
				`webveil: \`${name as string}\` and \`${now}\` in ${label} (${where}) ` +
					'are two spellings of the same browser engine. Keep ' +
					`\`${now}\` and remove \`${name as string}\` (the old spelling is ${NEXT}).`,
			);
		found.push([name as string, now, label]);
		return now;
	});
}

/** The one warning for every old browser engine name of a layer. */
function engineWarning(
	found: [string, string, string][],
	show: (name: string) => string,
	where: string,
): string {
	const what =
		found.length > 1 ? 'browser engine names' : 'browser engine name';
	const old = found.map(([name, , label]) => `${show(name)} in ${label}`);
	const now = found.map(([, name]) => show(name));
	return warning(`${what} ${old.join(', ')}`, now.join(', '), where);
}

/** The section's engine names (`engines`, `decoyGuard`) in the new browser prefix. */
function renameEngines(layer: Json, where: string, warnings: string[]): Json {
	const section = layer.searchcast;
	if (!isPlainObject(section)) return layer;
	const found: [string, string, string][] = [];
	const label = (key: string) => `\`searchcast.${key}\``;
	const next: Json = {...section};
	const list = (key: string, value: unknown) =>
		renameEngineList(value, label(key), where, found);
	if (Object.hasOwn(section, 'engines'))
		next.engines = list('engines', section.engines);
	const guard = section.decoyGuard;
	if (Array.isArray(guard)) next.decoyGuard = list('decoyGuard', guard);
	else if (isPlainObject(guard)) {
		const object: Json = {...guard};
		for (const key of ['include', 'exclude'])
			if (Object.hasOwn(guard, key))
				object[key] = list(`decoyGuard.${key}`, guard[key]);
		next.decoyGuard = object;
	}
	if (found.length === 0) return layer;
	warnings.push(engineWarning(found, (name) => `\`${name}\``, where));
	return {...layer, searchcast: next};
}

/**
 * A config file's JSON with every old spelling rewritten (see the table
 * above), and the warnings for the ones it used. Throws when a setting is
 * spelled both ways. `where` is the file path.
 */
export function normalizeFileLayer(
	value: Json,
	where: string,
): {value: Json; deprecations: string[]} {
	const warnings: string[] = [];
	if (!isPlainObject(value)) return {value, deprecations: warnings};
	let layer = value;
	// Each section's nested browser key first, so a conflict names the key
	// paths the user wrote.
	for (const name of ['searchcast', 'serpcast'])
		if (Object.hasOwn(layer, name))
			layer = {
				...layer,
				[name]: renameBrowser(layer[name], name, where, warnings),
			};
	layer = renameKey(
		layer,
		'serpcast',
		'searchcast',
		{old: 'serpcast', new: 'searchcast'},
		where,
		warnings,
	);
	layer = renameKey(
		layer,
		'fetchSerpcast',
		'fetchSearchcast',
		{old: 'fetchSerpcast', new: 'fetchSearchcast'},
		where,
		warnings,
	);
	layer = renameValue(layer, 'backend', where, warnings);
	layer = renameValue(layer, 'fetchTransport', where, warnings);
	layer = renameEngines(layer, where, warnings);
	return {value: layer, deprecations: warnings};
}

/** Env prefix renames, in order: the old prefix, then the nested browser key. */
const ENV_RULES: {from: string; to: string; label: string}[] = [
	{
		from: 'WEBVEIL_FETCH_SERPCAST_',
		to: 'WEBVEIL_FETCH_SEARCHCAST_',
		label: 'WEBVEIL_FETCH_SERPCAST_*',
	},
	{
		from: 'WEBVEIL_SERPCAST_',
		to: 'WEBVEIL_SEARCHCAST_',
		label: 'WEBVEIL_SERPCAST_*',
	},
	{
		from: 'WEBVEIL_SEARCHCAST_SEARCHCAST_',
		to: 'WEBVEIL_SEARCHCAST_BROWSER_',
		label: 'WEBVEIL_SEARCHCAST_SEARCHCAST_*',
	},
];

/** An env variable name with every rename rule applied, and the first rule used. */
function renameEnvName(name: string): {name: string; label?: string} {
	let label: string | undefined;
	for (const rule of ENV_RULES)
		if (name.startsWith(rule.from)) {
			name = rule.to + name.slice(rule.from.length);
			label ??= rule.label;
		}
	return {name, label};
}

/**
 * The environment with every old variable name rewritten (and
 * `WEBVEIL_BACKEND` / `WEBVEIL_FETCH_TRANSPORT` values `serpcast` as
 * `searchcast`), and one warning per old prefix used. Throws when one setting
 * is set under two names. Empty variables count as unset.
 */
export function normalizeEnv(env: Env): {env: Env; deprecations: string[]} {
	const out: Env = {};
	const renamed = new Map<string, [string, string][]>();
	const from = new Map<string, string>();
	const names = Object.keys(env).sort(); // stable warnings and errors
	for (const name of names) {
		const value = env[name];
		const target = renameEnvName(name);
		if (!target.label) {
			if (value) {
				const other = from.get(name);
				if (other) throw conflict(other, name, 'env');
				from.set(name, name);
			}
			if (!(name in out) || value) out[name] = value;
			continue;
		}
		if (!value) continue;
		const other = from.get(target.name);
		if (other)
			throw other === target.name
				? conflict(name, other, 'env')
				: conflict(other, name, 'env');
		from.set(target.name, name);
		out[target.name] = value;
		const list = renamed.get(target.label) ?? [];
		list.push([name, target.name]);
		renamed.set(target.label, list);
	}
	const deprecations = [...renamed.values()].map((pairs) =>
		warning(
			pairs.map(([old]) => old).join(', '),
			pairs.map(([, now]) => now).join(', '),
			'env',
		),
	);
	for (const key of ['WEBVEIL_BACKEND', 'WEBVEIL_FETCH_TRANSPORT'])
		if (out[key] === 'serpcast') {
			deprecations.push(warning(`${key}=serpcast`, `${key}=searchcast`, 'env'));
			out[key] = 'searchcast';
		}
	// Engine names in the decoy guard lists (comma-separated, config.ts).
	const found: [string, string, string][] = [];
	for (const key of [
		'WEBVEIL_SEARCHCAST_DECOY_GUARD',
		'WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE',
	]) {
		if (!out[key]) continue;
		const names = out[key].split(',').map((name) => name.trim());
		const before = found.length;
		const renamed = renameEngineList(names, key, 'env', found) as string[];
		if (found.length > before) out[key] = renamed.join(',');
	}
	if (found.length > 0)
		deprecations.push(engineWarning(found, (name) => name, 'env'));
	return {env: out, deprecations};
}

const DEPRECATIONS = Symbol('webveil.deprecations');

/** Attach the deprecation warnings of a resolved config (non-enumerable). */
export function attachDeprecations<T extends object>(
	config: T,
	deprecations: string[],
): T {
	Object.defineProperty(config, DEPRECATIONS, {value: deprecations});
	return config;
}

/**
 * The deprecated spellings a config produced by `resolveConfig` used, as
 * warnings naming the new spelling; empty for any other config.
 */
export function configDeprecations(config: object): string[] {
	return (config as {[DEPRECATIONS]?: string[]})[DEPRECATIONS] ?? [];
}

const printed = new Set<string>();

/** The default warning sink: stderr, each distinct message once per process. */
export function warnOnce(message: string): void {
	if (printed.has(message)) return;
	printed.add(message);
	process.stderr.write(`${message}\n`);
}

/** Hand each deprecation warning of `config` to `sink` (default `warnOnce`). */
export function reportDeprecations(
	config: object,
	sink: (message: string) => void = warnOnce,
): void {
	for (const message of configDeprecations(config)) sink(message);
}
