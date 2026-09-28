// config layering: a key-by-key deep merge of the config layers (defaults <
// global < project < env) that records, for every resolved LEAF key path, which
// layer set it (its provenance). Provenance is what lets the trust check
// (trust.ts) refuse an executable setting that came from a project
// `webveil.json`, key by key. See docs/adr/0004.
//
// MERGE RULE (recorded decision): plain-object sections merge key by key, so a
// project file that sets one key of a section keeps the global layer's other
// keys. Scalars and arrays are LEAVES, replaced whole by the highest layer that
// sets them. `egress` and `fetchEgress` are also leaves (WHOLE_KEYS): they are
// tagged unions keyed by `mode`, and before this change the shallow
// `Object.assign` replaced them whole, which their semantics rely on. Merging
// them would build mixed objects: a global `{mode: socks5, url}` under a project
// `{mode: direct}` would become `direct` with a stray url, and a project
// `{mode: http}` without a url would silently inherit the global SOCKS url
// instead of failing loud. They were the only object-valued keys before this
// change, so every existing config resolves exactly as it did.

/** Which layer a resolved key came from. File layers carry the file's path. */
export type ConfigSource =
	| {layer: 'env'}
	| {layer: 'project'; path: string}
	| {layer: 'global'; path: string}
	| {layer: 'defaults'};

/** Leaf key path (dot-joined, e.g. `baseUrl`, `serpcast.engines`) -> source. */
export type Provenance = Record<string, ConfigSource>;

/** One config layer: its parsed content and where it came from. */
export interface Layer {
	value: Record<string, unknown>;
	source: ConfigSource;
}

/** Object-valued key paths that are leaves (replaced whole, never merged). */
const WHOLE_KEYS = new Set(['egress', 'fetchEgress']);

const PROVENANCE = Symbol('webveil.provenance');

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Forget the provenance of `path` and everything nested under it. */
function forget(provenance: Provenance, path: string): void {
	for (const key of Object.keys(provenance))
		if (key === path || key.startsWith(`${path}.`)) delete provenance[key];
}

function mergeInto(
	target: Record<string, unknown>,
	layer: Record<string, unknown>,
	source: ConfigSource,
	provenance: Provenance,
	prefix: string,
): void {
	for (const key of Object.keys(layer)) {
		if (key === '__proto__') continue; // never let a JSON file re-prototype
		const path = prefix ? `${prefix}.${key}` : key;
		const value = layer[key];
		if (isPlainObject(value) && !WHOLE_KEYS.has(path)) {
			if (!isPlainObject(target[key])) {
				forget(provenance, path);
				target[key] = {};
			}
			const section = target[key] as Record<string, unknown>;
			mergeInto(section, value, source, provenance, path);
		} else {
			forget(provenance, path);
			target[key] = value;
			provenance[path] = source;
		}
	}
}

/**
 * Merge `layers` (lowest precedence first) key by key and record each leaf's
 * provenance. The input layers are never mutated.
 */
export function mergeLayers(layers: Layer[]): {
	value: Record<string, unknown>;
	provenance: Provenance;
} {
	const value: Record<string, unknown> = {};
	const provenance: Provenance = {};
	for (const layer of layers)
		if (isPlainObject(layer.value))
			mergeInto(value, layer.value, layer.source, provenance, '');
	return {value, provenance};
}

/**
 * Attach provenance to a resolved config object. Stored under a non-enumerable
 * symbol so the config's own shape (equality, JSON, spreading into a
 * backend-facing copy) is exactly what it was before provenance existed.
 */
export function attachProvenance<T extends object>(
	config: T,
	provenance: Provenance,
): T {
	Object.defineProperty(config, PROVENANCE, {value: provenance});
	return config;
}

/**
 * The provenance of a config produced by `resolveConfig`, or `undefined` for a
 * config built in code (tests, programmatic callers), which no file supplied.
 * A spread copy (`{...config}`) drops it; use `carryProvenance` on such copies.
 */
export function configProvenance(config: object): Provenance | undefined {
	return (config as {[PROVENANCE]?: Provenance})[PROVENANCE];
}

/** Copy `from`'s provenance (if any) onto a derived config `to`. */
export function carryProvenance<T extends object>(from: object, to: T): T {
	const provenance = configProvenance(from);
	return provenance ? attachProvenance(to, provenance) : to;
}
