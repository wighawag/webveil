// config seam — per-folder resolution. Precedence (highest wins):
//   env > nearest webveil.json (walking up from cwd) > global
//   $XDG_CONFIG_HOME/webveil/config.json (~/.config/webveil/config.json) >
//   defaults.
// "Per folder = per account/egress." Each layer is a partial; later (lower)
// layers fill gaps the higher layers leave. Plain-object sections merge key by
// key (`egress`/`fetchEgress` are replaced whole) and every resolved leaf keeps
// its provenance, so executable settings can be refused from a project file
// (layers.ts, trust.ts, docs/adr/0004). The project file is a
// frontend-neutral `webveil.json` (no `.pi/`): both the pi-agnostic CLI and the
// pi extension resolve the same name, so a project is configured the same way
// regardless of which frontend reads it. See docs/adr/0002.

import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, dirname, join, parse} from 'node:path';
import {attachProvenance, mergeLayers} from './layers.js';
import type {Layer} from './layers.js';

/** How outbound HTTP leaves the machine. See egress.ts. */
export type Egress =
	| {mode: 'direct'}
	| {mode: 'http'; url: string}
	| {mode: 'socks5'; url: string};

/**
 * The `serpcast` backend's section (see backends/serpcast.ts). Merged key by
 * key across layers, so a project file setting `engines` keeps the global
 * `libcurlPath`. There is deliberately no `strict` key: strict impersonation is
 * always on (docs/adr/0004).
 *
 * Recorded decision (task serpcast-backend-basic): the key names follow
 * serpcast's options (`libcurlPath`, `sessionIdleMs`, `cooldownMs`); `recipes`
 * takes declarative recipe files or directories (serpcast-recipe's
 * `loadRecipes`), named to pair with the planned `codeRecipes`. Recipes are data,
 * so any layer may set them, but their paths resolve like executable ones
 * (config-file relative, never the cwd). Env covers the scalars only
 * (`WEBVEIL_SERPCAST_LIBCURL_PATH`, `_SESSION_IDLE_MS`, `_COOLDOWN_MS`); lists
 * live in files. Alternative considered: `recipeDirs` (too narrow, files work).
 *
 * Recorded decision (task serpcast-code-recipes-trusted): `codeRecipes` takes
 * JS module files or directories (every `*.js`/`*.mjs` inside, sorted, as
 * `loadRecipes` does for `*.json`). Loading one RUNS it, so it is an executable
 * setting (trusted layers only). Its env form is `WEBVEIL_SERPCAST_CODE_RECIPES`,
 * a list split on the platform path delimiter (`:`, or `;` on Windows) like
 * PATH, each entry absolute or `~/`. It is the only list with an env form:
 * without one, env could not supply a trusted code recipe path at all.
 * Alternative considered: a JSON array in env (awkward to type in a shell).
 */
export interface SerpcastConfig {
	/** Engine names, tried in order (each names a loaded recipe). */
	engines?: string[];
	/** Declarative recipe files or directories (every `*.json` inside). */
	recipes?: string[];
	/** Code recipe modules or directories: EXECUTABLE (trusted layers only). */
	codeRecipes?: string[];
	/** The libcurl-impersonate library: EXECUTABLE (trusted layers only). */
	libcurlPath?: string;
	sessionIdleMs?: number;
	cooldownMs?: number;
}

/** Page-size budget preset for fetch (passed through to distilly). */
export type FetchSize = 's' | 'm' | 'l' | 'f';

/** The fully-resolved config every webveil module consumes. */
export interface Config {
	backend: string;
	baseUrl: string;
	apiKey?: string;
	/**
	 * The BACKEND-hop egress (webveil -> backend `baseUrl`). Also the FETCH-hop
	 * default when `fetchEgress` is unset, so a single-knob config governs both
	 * hops exactly as before.
	 */
	egress: Egress;
	/**
	 * The FETCH-hop egress (webveil -> arbitrary public URL, and the `fetch`
	 * injected into distilly). OPTIONAL: when unset it INHERITS `egress`, so
	 * existing single-`egress` configs are unchanged. Setting it lets a LOCAL
	 * backend stay on a `direct` backend hop while `web_fetch` exits via a
	 * proxy (e.g. local SearXNG + socks5 web_fetch). See docs/adr/0003.
	 */
	fetchEgress?: Egress;
	fetchSize: FetchSize;
	/** Settings of the `serpcast` backend (unused by the other backends). */
	serpcast?: SerpcastConfig;
}

/** A config file / env layer: any subset of the resolved shape. */
export type PartialConfig = Partial<Config>;

export interface ResolveOptions {
	/** Directory the per-folder walk starts from. Defaults to process.cwd(). */
	cwd?: string;
	/** Environment to read overrides from. Defaults to process.env. */
	env?: Record<string, string | undefined>;
	/** Home directory for the XDG fallback. Defaults to os.homedir(). */
	homeDir?: string;
	/**
	 * Path to the global config file. When given it WINS outright and the XDG
	 * resolution is skipped. Tests point this at a temp dir to isolate the real
	 * home directory. When absent, the global file resolves to
	 * $XDG_CONFIG_HOME/webveil/config.json, falling back to
	 * <homeDir>/.config/webveil/config.json.
	 */
	globalPath?: string;
}

const DEFAULTS: Config = {
	backend: 'searxng',
	baseUrl: 'http://127.0.0.1:8080',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

const PROJECT_FILE = 'webveil.json';

function readJson(path: string): Record<string, unknown> | undefined {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		return undefined; // absent file is fine; missing layers are expected
	}
	return JSON.parse(text) as Record<string, unknown>;
}

/** The nearest `webveil.json` walking up from `cwd` (first found wins). */
function readProjectChain(cwd: string): Layer | undefined {
	let dir = cwd;
	const {root} = parse(dir);
	for (;;) {
		const path = join(dir, PROJECT_FILE);
		const found = readJson(path);
		if (found) return {value: found, source: {layer: 'project', path}};
		if (dir === root) return undefined;
		dir = dirname(dir);
	}
}

/** The global config file as a layer (empty when the file is absent). */
function readGlobal(path: string): Layer {
	return {value: readJson(path) ?? {}, source: {layer: 'global', path}};
}

/**
 * Parse an egress mode/url pair into an `Egress`, or `undefined` when the mode
 * env var is unset (so the layer leaves the key absent and lower layers fill it).
 * Shared by the backend (`WEBVEIL_EGRESS*`) and fetch (`WEBVEIL_FETCH_EGRESS*`)
 * env knobs so the two hops parse identically.
 */
function parseEgressEnv(
	mode: string | undefined,
	url: string | undefined,
): Egress | undefined {
	if (mode === 'direct') return {mode: 'direct'};
	if (mode === 'http' || mode === 'socks5') return {mode, url: url ?? ''};
	return undefined;
}

/** The `serpcast` settings from `WEBVEIL_SERPCAST_*` (lists: code recipes only). */
function readSerpcastEnv(
	env: Record<string, string | undefined>,
): SerpcastConfig {
	const section: SerpcastConfig = {};
	const {
		WEBVEIL_SERPCAST_LIBCURL_PATH: lib,
		WEBVEIL_SERPCAST_SESSION_IDLE_MS: idle,
		WEBVEIL_SERPCAST_COOLDOWN_MS: cooldown,
		WEBVEIL_SERPCAST_CODE_RECIPES: code,
	} = env;
	if (code) section.codeRecipes = code.split(delimiter).filter(Boolean);
	if (lib) section.libcurlPath = lib;
	if (idle) section.sessionIdleMs = Number(idle);
	if (cooldown) section.cooldownMs = Number(cooldown);
	return section;
}

function readEnv(env: Record<string, string | undefined>): PartialConfig {
	const layer: PartialConfig = {};
	if (env.WEBVEIL_BACKEND) layer.backend = env.WEBVEIL_BACKEND;
	if (env.WEBVEIL_BASE_URL) layer.baseUrl = env.WEBVEIL_BASE_URL;
	if (env.WEBVEIL_API_KEY) layer.apiKey = env.WEBVEIL_API_KEY;
	if (env.WEBVEIL_FETCH_SIZE)
		layer.fetchSize = env.WEBVEIL_FETCH_SIZE as FetchSize;
	const egress = parseEgressEnv(env.WEBVEIL_EGRESS, env.WEBVEIL_EGRESS_URL);
	if (egress) layer.egress = egress;
	const fetchEgress = parseEgressEnv(
		env.WEBVEIL_FETCH_EGRESS,
		env.WEBVEIL_FETCH_EGRESS_URL,
	);
	if (fetchEgress) layer.fetchEgress = fetchEgress;
	const serpcast = readSerpcastEnv(env);
	if (Object.keys(serpcast).length > 0) layer.serpcast = serpcast;
	return layer;
}

/**
 * The global config path, XDG-style: `$XDG_CONFIG_HOME/webveil/config.json`,
 * falling back to `<homeDir>/.config/webveil/config.json` when XDG_CONFIG_HOME
 * is unset. (`options.globalPath`, when given, bypasses this entirely.)
 */
function resolveGlobalPath(
	env: Record<string, string | undefined>,
	homeDir = homedir(),
): string {
	const base = env.XDG_CONFIG_HOME || join(homeDir, '.config');
	return join(base, 'webveil', 'config.json');
}

/**
 * Resolve the effective config. Higher-precedence layers override lower ones,
 * key by key: env > project chain > global file > defaults. The result carries
 * its per-key provenance (read it with `configProvenance`).
 */
export function resolveConfig(options: ResolveOptions = {}): Config {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const globalPath =
		options.globalPath ?? resolveGlobalPath(env, options.homeDir);

	const project = readProjectChain(cwd);
	const layers: Layer[] = [
		{value: {...DEFAULTS}, source: {layer: 'defaults'}},
		readGlobal(globalPath),
		...(project ? [project] : []),
		{value: {...readEnv(env)}, source: {layer: 'env'}},
	];
	const {value, provenance} = mergeLayers(layers);
	return attachProvenance(value as unknown as Config, provenance);
}
