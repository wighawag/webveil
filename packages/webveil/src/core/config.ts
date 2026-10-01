// config seam: per-folder resolution. Precedence (highest wins):
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
import {attachProvenance, configProvenance, mergeLayers} from './layers.js';
import type {Layer} from './layers.js';
import {
	attachDeprecations,
	normalizeEnv,
	normalizeFileLayer,
} from './spellings.js';

/** How outbound HTTP leaves the machine. See egress.ts. */
export type Egress =
	| {mode: 'direct'}
	| {mode: 'http'; url: string}
	| {mode: 'socks5'; url: string};

/**
 * The `searchcast` backend's section (see backends/searchcast.ts). Merged key by
 * key across layers, so a project file setting `engines` keeps the global
 * `libcurlPath`. There is deliberately no `strict` key: strict impersonation is
 * always on (docs/adr/0004).
 *
 * Recorded decision (task serpcast-backend-basic): the key names follow
 * searchcast's options (`libcurlPath`, `sessionIdleMs`, `cooldownMs`); `recipes`
 * takes declarative recipe files or directories (serpcast-recipe's
 * `loadRecipes`), named to pair with the planned `codeRecipes`. Recipes are data,
 * so any layer may set them, but their paths resolve like executable ones
 * (config-file relative, never the cwd). Env covers the scalars only
 * (`WEBVEIL_SEARCHCAST_LIBCURL_PATH`, `_SESSION_IDLE_MS`, `_COOLDOWN_MS`); lists
 * live in files. Alternative considered: `recipeDirs` (too narrow, files work).
 *
 * Recorded decision (task serpcast-code-recipes-trusted): `codeRecipes` takes
 * JS module files or directories (every `*.js`/`*.mjs` inside, sorted, as
 * `loadRecipes` does for `*.json`). Loading one RUNS it, so it is an executable
 * setting (trusted layers only). Its env form is `WEBVEIL_SEARCHCAST_CODE_RECIPES`,
 * a list split on the platform path delimiter (`:`, or `;` on Windows) like
 * PATH, each entry absolute or `~/`. It is the only list with an env form:
 * without one, env could not supply a trusted code recipe path at all.
 * Alternative considered: a JSON array in env (awkward to type in a shell).
 *
 * Recorded decision (task serpcast-0-5-recipes-and-nixos-docs): `recipes` and
 * `codeRecipes` entries may also name an installed recipe set, `set:<name>` or
 * `set:<name>/<file>` (see backends/searchcast.ts). In the env list a `set:`
 * entry stays whole although POSIX splits on `:` (`splitPathList`).
 *
 * Recorded decision (task searchcast-fallback-and-guard): the browser fallback
 * is the `browser` subsection (`BrowserConfig`); its env forms cover the
 * three executable keys only: `WEBVEIL_SEARCHCAST_BROWSER_CHROME`, `_XVFB`
 * (paths, absolute or `~/`) and `_CHROME_ARGS` (split on whitespace, like
 * NODE_OPTIONS: Chromium flags carry no spaces). Mode, endpoint and profile
 * persistence live in files. Alternative considered: a JSON array for the args
 * (awkward to type, as for code recipes).
 *
 * Recorded decision (task serpcast-0-2-decoy-guard): `decoyGuard` takes engine
 * names, passed as is to searchcast's `decoyGuard` option (the key name follows
 * searchcast's, like the others). It is data, not executable: any layer may set
 * it. Its env form `WEBVEIL_SEARCHCAST_DECOY_GUARD` is split on commas (spaces
 * around a name trimmed): an engine name is a recipe name, which never needs a
 * comma, whereas the path delimiter (`codeRecipes`) or whitespace
 * (`chromeArgs`) would be surprising for a list of names. A name missing from
 * `engines` is NOT an error (unlike `engines` itself): a global
 * `decoyGuard: ["engine-a"]` must keep working in a project whose chain has no
 * `engine-a`; searchcast simply never judges it. Alternative considered:
 * failing on such a name, rejected for that layering reason.
 *
 * Recorded decisions (task webveil-installs-and-tunables; rules and defaults:
 * tunables.ts): searchcast's tuning options pass through under their searchcast
 * names (`timeoutMs`, `maxBodyBytes`, `reuseConnections`, `keepSessions`,
 * `idlePollMs`, `maxRequestBodyBytes`, `preflightCache`, `maxPreflightAgeS`,
 * `maxRedirects`, `decoyRule`), and `decoyGuard` also takes searchcast's object
 * form `{include, exclude}`. `decoyGuard` is a WHOLE key (layers.ts): an
 * array in one layer and an object in another would otherwise merge into a
 * mix of both, so the highest layer's guard wins whole, as the array always
 * did. The browser endpoint's limits are `searchcast.timeoutMs` and
 * `searchcast.maxBodyBytes` (endpoint mode only). The state store's switches
 * are the `state` subsection (`persist`, `lockStaleMs`, `lockWaitMs`), inside
 * `searchcast` because it is searchcast's state (CONTEXT.md) and so joins the
 * identity key like everything else in the section. Every key has an env
 * form, `WEBVEIL_SEARCHCAST_<KEY>` in upper snake case (`_DECOY_RULE_TOP`,
 * `_BROWSER_TIMEOUT_MS`, `_STATE_PERSIST`, ...), and
 * `WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE` (comma-separated) gives the object
 * form. An env switch is `true` or `false`; anything else is kept as given so
 * validation names it, never silently read as off.
 */
export interface SearchcastConfig {
	/** Engine names, tried in order (each names a loaded recipe). */
	engines?: string[];
	/** Declarative recipe files or directories (every `*.json` inside), or `set:<name>[/<file>]`. */
	recipes?: string[];
	/** Code recipe modules or directories, or `set:<name>[/<file>]`: EXECUTABLE (trusted layers only). */
	codeRecipes?: string[];
	/** The libcurl-impersonate library: EXECUTABLE (trusted layers only). */
	libcurlPath?: string;
	sessionIdleMs?: number;
	cooldownMs?: number;
	/** Engines whose answers searchcast checks for decoys, or `{include, exclude}`. */
	decoyGuard?: string[] | {include?: string[]; exclude?: string[]};
	/** The decoy rule's thresholds (searchcast's `decoyRule`). */
	decoyRule?: {top?: number; maxRelevant?: number; prefix?: number};
	/** searchcast transport and chain options, passed as is. */
	timeoutMs?: number;
	maxBodyBytes?: number;
	reuseConnections?: boolean;
	keepSessions?: boolean;
	idlePollMs?: number;
	maxRequestBodyBytes?: number;
	preflightCache?: boolean;
	maxPreflightAgeS?: number;
	maxRedirects?: number;
	/** The searchcast browser fallback (engines named `searchcast:<recipe>`). */
	browser?: BrowserConfig;
	/** Where searchcast state lives (state.ts). */
	state?: StateConfig;
}

/** The searchcast state store's switches (state.ts). */
export interface StateConfig {
	/** `false`: searchcast's in-memory store, nothing written to disk. Default true. */
	persist?: boolean;
	/** A lock older than this is broken (a crashed writer). Default 10 s. */
	lockStaleMs?: number;
	/** Waiting longer than this for the lock is an error. Default 30 s. */
	lockWaitMs?: number;
}

/**
 * How the searchcast backend reaches searchcast (backends/searchcast.ts). Key names
 * follow searchcast's `SearchcastLibraryOptions` (`chrome`, `xvfb`, `chromeArgs`).
 */
export interface BrowserConfig {
	/**
	 * `library` (default): webveil starts searchcast in-process, with the egress
	 * as the browser's proxy. `endpoint`: a `searchcast serve` the user runs.
	 */
	mode?: 'library' | 'endpoint';
	/** Endpoint mode: the server's URL or Unix socket path. */
	endpoint?: string;
	/** Library mode: the Chrome/Chromium executable: EXECUTABLE. */
	chrome?: string;
	/** Library mode: an Xvfb executable for a private display: EXECUTABLE. */
	xvfb?: string;
	/** Library mode: extra Chromium arguments: EXECUTABLE. */
	chromeArgs?: string[];
	/**
	 * Library mode: keep the browser profile in the identity's state partition
	 * (deleted once idle past `sessionIdleMs`). Default: an ephemeral profile.
	 */
	persistProfile?: boolean;
	/** Endpoint mode: the whole request's time limit in ms (searchcast: 30 s). */
	timeoutMs?: number;
	/** Endpoint mode: the largest answer accepted, in bytes (searchcast: 16 MiB). */
	maxBodyBytes?: number;
}

/** The searchcast `web_fetch` transport's values (tunables.ts, fetch-transport.ts). */
export interface FetchSearchcastConfig {
	maxIdleSessions?: number;
	sessionIdleMs?: number;
	reuseConnections?: boolean;
	timeoutMs?: number;
	maxBodyBytes?: number;
}

/**
 * How `web_fetch` sends its requests (fetch-transport.ts): `plain` is undici
 * over the egress dispatcher (a Node TLS fingerprint); `searchcast` is searchcast's
 * libcurl-impersonate transport (Chrome's TLS/HTTP2 fingerprint). No default in
 * DEFAULTS: when unset it follows `backend` (`resolveFetchTransport`).
 */
export type FetchTransport = 'plain' | 'searchcast';

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
	/**
	 * The `web_fetch` transport. OPTIONAL: unset, it is `searchcast` when
	 * `backend` is `searchcast` and `plain` otherwise (`resolveFetchTransport`).
	 */
	fetchTransport?: FetchTransport;
	/** Redirects `web_fetch` follows (both transports). Default 20. */
	fetchMaxRedirects?: number;
	/** The searchcast `web_fetch` transport's pool and limits. */
	fetchSearchcast?: FetchSearchcastConfig;
	/** Results a search returns when the caller passes no `maxResults`. Default 10. */
	maxResults?: number;
	/** The backend http helper's per-request timeout in ms. Default 30 s. */
	httpTimeoutMs?: number;
	/** Settings of the `searchcast` backend (unused by the other backends). */
	searchcast?: SearchcastConfig;
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

/**
 * Recorded decisions (task default-backend-searchcast, spec
 * searchcast-backend; owner-approved Marginalia chain):
 * - The default `backend` is `searchcast` (it was `searxng`), still on
 *   `direct` egress. Its engine chain, when the user sets none, is the
 *   bundled code recipes (Mwmbl then Marginalia since task
 *   default-chain-mwmbl), filled in by the backend, not here
 *   (backends/searchcast.ts explains why: a key-by-key merge would mix a
 *   user's chain with the default one).
 * - `baseUrl` keeps its old default `http://127.0.0.1:8080`: searchcast does
 *   not use it, and it is what makes `backend: "searxng"` alone restore the
 *   previous default exactly.
 * - No probe for a local SearXNG (a guess, and a network call nobody asked
 *   for). Instead, while `backend` comes from these defaults
 *   (`usesDefaultBackend`), a failed search (search.ts) and `webveil doctor`
 *   (setup.ts, a `defaultBackend` notice, not a problem) carry
 *   `DEFAULT_BACKEND_NOTE`. Alternative considered: a one-time warning on
 *   every command, rejected as noise for the users the default works for.
 */
const DEFAULTS: Config = {
	backend: 'searchcast',
	baseUrl: 'http://127.0.0.1:8080',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

/** What a user who relied on the old implicit SearXNG default needs to know. */
export const DEFAULT_BACKEND_NOTE =
	'the default backend changed in webveil 0.11: it is now searchcast with a ' +
	'bundled engine chain (it was a local SearXNG at ' +
	'http://127.0.0.1:8080); set "backend": "searxng" (or ' +
	'WEBVEIL_BACKEND=searxng) to restore the previous default';

/** True when `backend` was set by no config layer (the built-in default). */
export function usesDefaultBackend(config: Config): boolean {
	return configProvenance(config)?.backend?.layer === 'defaults';
}

const PROJECT_FILE = 'webveil.json';

/** A layer read from a config file. */
type FileLayer = Layer & {
	source: {layer: 'project' | 'global'; path: string};
};

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
function readProjectChain(cwd: string): FileLayer | undefined {
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
function readGlobal(path: string): FileLayer {
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

/**
 * A PATH-like list split on the platform delimiter, keeping an installed set
 * entry (`set:<name>`, backends/searchcast.ts) whole where the delimiter is `:`:
 * a lone `set` token would be a relative path, which env never accepts.
 */
function splitPathList(value: string): string[] {
	const parts = value.split(delimiter);
	const list: string[] = [];
	for (let i = 0; i < parts.length; i++)
		if (delimiter === ':' && parts[i] === 'set' && i + 1 < parts.length)
			list.push(`set:${parts[++i]}`);
		else list.push(parts[i]!);
	return list.filter(Boolean);
}

type Env = Record<string, string | undefined>;

/** An env number (NaN for garbage, so validation fails loud). */
const envNumber = (value: string) => Number(value);
/** An env switch: `true`/`false`, else the raw text (validation names it). */
const envBoolean = (value: string) =>
	value === 'true' ? true : value === 'false' ? false : value;
/** A comma-separated list of names, spaces around each trimmed. */
const envNames = (value: string) =>
	value
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);

/**
 * Copy each set env variable `<prefix><SUFFIX>` into `target[key]`, parsed:
 * `keys` maps a key to `[SUFFIX, parse]`. Unset or empty variables are skipped.
 */
function readKeys(
	env: Env,
	prefix: string,
	keys: Record<string, [string, (value: string) => unknown]>,
): Record<string, unknown> {
	const target: Record<string, unknown> = {};
	for (const [key, [suffix, parse]] of Object.entries(keys)) {
		const value = env[prefix + suffix];
		if (value) target[key] = parse(value);
	}
	return target;
}

const SEARCHCAST_ENV_KEYS: Record<string, [string, (v: string) => unknown]> = {
	timeoutMs: ['TIMEOUT_MS', envNumber],
	maxBodyBytes: ['MAX_BODY_BYTES', envNumber],
	reuseConnections: ['REUSE_CONNECTIONS', envBoolean],
	keepSessions: ['KEEP_SESSIONS', envBoolean],
	idlePollMs: ['IDLE_POLL_MS', envNumber],
	maxRequestBodyBytes: ['MAX_REQUEST_BODY_BYTES', envNumber],
	preflightCache: ['PREFLIGHT_CACHE', envBoolean],
	maxPreflightAgeS: ['MAX_PREFLIGHT_AGE_S', envNumber],
	maxRedirects: ['MAX_REDIRECTS', envNumber],
	sessionIdleMs: ['SESSION_IDLE_MS', envNumber],
	cooldownMs: ['COOLDOWN_MS', envNumber],
};

/** Set `section[key]` to `value` unless it is an empty object. */
function setSection(
	section: Record<string, unknown>,
	key: string,
	value: Record<string, unknown>,
): void {
	if (Object.keys(value).length > 0) section[key] = value;
}

/** The `searchcast` settings from `WEBVEIL_SEARCHCAST_*` (lists: code recipes, chrome args, decoy guard). */
function readSearchcastEnv(env: Env): SearchcastConfig {
	const P = 'WEBVEIL_SEARCHCAST_';
	const section = readKeys(env, P, SEARCHCAST_ENV_KEYS) as SearchcastConfig;
	const extra = section as Record<string, unknown>;
	setSection(
		extra,
		'decoyRule',
		readKeys(env, `${P}DECOY_RULE_`, {
			top: ['TOP', envNumber],
			maxRelevant: ['MAX_RELEVANT', envNumber],
			prefix: ['PREFIX', envNumber],
		}),
	);
	setSection(
		extra,
		'state',
		readKeys(env, `${P}STATE_`, {
			persist: ['PERSIST', envBoolean],
			lockStaleMs: ['LOCK_STALE_MS', envNumber],
			lockWaitMs: ['LOCK_WAIT_MS', envNumber],
		}),
	);
	const {
		WEBVEIL_SEARCHCAST_LIBCURL_PATH: lib,
		WEBVEIL_SEARCHCAST_CODE_RECIPES: code,
		WEBVEIL_SEARCHCAST_BROWSER_CHROME: chrome,
		WEBVEIL_SEARCHCAST_BROWSER_XVFB: xvfb,
		WEBVEIL_SEARCHCAST_BROWSER_CHROME_ARGS: args,
		WEBVEIL_SEARCHCAST_DECOY_GUARD: decoy,
		WEBVEIL_SEARCHCAST_DECOY_GUARD_EXCLUDE: exclude,
	} = env;
	const browser = readKeys(env, `${P}BROWSER_`, {
		timeoutMs: ['TIMEOUT_MS', envNumber],
		maxBodyBytes: ['MAX_BODY_BYTES', envNumber],
	}) as BrowserConfig;
	if (chrome) browser.chrome = chrome;
	if (xvfb) browser.xvfb = xvfb;
	if (args?.trim()) browser.chromeArgs = args.trim().split(/\s+/);
	if (Object.keys(browser).length > 0) section.browser = browser;
	if (code) section.codeRecipes = splitPathList(code);
	if (exclude?.trim())
		section.decoyGuard = {
			...(decoy?.trim() ? {include: envNames(decoy)} : {}),
			exclude: envNames(exclude),
		};
	else if (decoy?.trim()) section.decoyGuard = envNames(decoy);
	if (lib) section.libcurlPath = lib;
	return section;
}

function readEnv(env: Env): PartialConfig {
	const layer = readKeys(env, 'WEBVEIL_', {
		maxResults: ['MAX_RESULTS', envNumber],
		httpTimeoutMs: ['HTTP_TIMEOUT_MS', envNumber],
		fetchMaxRedirects: ['FETCH_MAX_REDIRECTS', envNumber],
	}) as PartialConfig;
	setSection(
		layer as Record<string, unknown>,
		'fetchSearchcast',
		readKeys(env, 'WEBVEIL_FETCH_SEARCHCAST_', {
			maxIdleSessions: ['MAX_IDLE_SESSIONS', envNumber],
			sessionIdleMs: ['SESSION_IDLE_MS', envNumber],
			reuseConnections: ['REUSE_CONNECTIONS', envBoolean],
			timeoutMs: ['TIMEOUT_MS', envNumber],
			maxBodyBytes: ['MAX_BODY_BYTES', envNumber],
		}),
	);
	if (env.WEBVEIL_BACKEND) layer.backend = env.WEBVEIL_BACKEND;
	if (env.WEBVEIL_BASE_URL) layer.baseUrl = env.WEBVEIL_BASE_URL;
	if (env.WEBVEIL_API_KEY) layer.apiKey = env.WEBVEIL_API_KEY;
	if (env.WEBVEIL_FETCH_SIZE)
		layer.fetchSize = env.WEBVEIL_FETCH_SIZE as FetchSize;
	if (env.WEBVEIL_FETCH_TRANSPORT)
		layer.fetchTransport = env.WEBVEIL_FETCH_TRANSPORT as FetchTransport;
	const egress = parseEgressEnv(env.WEBVEIL_EGRESS, env.WEBVEIL_EGRESS_URL);
	if (egress) layer.egress = egress;
	const fetchEgress = parseEgressEnv(
		env.WEBVEIL_FETCH_EGRESS,
		env.WEBVEIL_FETCH_EGRESS_URL,
	);
	if (fetchEgress) layer.fetchEgress = fetchEgress;
	const searchcast = readSearchcastEnv(env);
	if (Object.keys(searchcast).length > 0) layer.searchcast = searchcast;
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

	// Every layer is rewritten to the new spellings BEFORE the merge, so
	// provenance, trust and identity only ever see one (spellings.ts).
	const deprecations: string[] = [];
	const file = (layer: FileLayer): Layer => {
		const normalized = normalizeFileLayer(layer.value, layer.source.path);
		deprecations.push(...normalized.deprecations);
		return {...layer, value: normalized.value};
	};
	const project = readProjectChain(cwd);
	const envLayer = normalizeEnv(env);
	const layers: Layer[] = [
		{value: {...DEFAULTS}, source: {layer: 'defaults'}},
		file(readGlobal(globalPath)),
		...(project ? [file(project)] : []),
		{value: {...readEnv(envLayer.env)}, source: {layer: 'env'}},
	];
	deprecations.push(...envLayer.deprecations);
	const {value, provenance} = mergeLayers(layers);
	return attachDeprecations(
		attachProvenance(value as unknown as Config, provenance),
		deprecations,
	);
}
