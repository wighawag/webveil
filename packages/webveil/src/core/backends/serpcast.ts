// serpcast backend: keyless search with no SearXNG. serpcast (policy-free, its
// ADR 0002) runs recipes over libcurl-impersonate; webveil injects the policy
// (docs/adr/0004): the backend-hop `egress` is serpcast's proxy, strict
// impersonation is always on, the libcurl path and code recipe paths are
// executable settings.
// serpcast owns its own I/O, so the handed `http` helper is unused (as custom).
//
// Recorded decisions (task serpcast-backend-basic; config keys: config.ts,
// identity key: identity.ts):
// - No `engines` is an error, not "every loaded recipe": the order decides which
//   engines see traffic, so it must be chosen. An unknown name is an error too.
// - An `empty` answer after failures returns [] (serpcast's genuine "no
//   results"); only `exhausted` is an error. Failed engines before an answer
//   annotate the results as `unresponsiveEngines`, as for searxng.
//
// Recorded decisions (task serpcast-code-recipes-trusted; key and env form:
// config.ts):
// - `serpcast.codeRecipes` joins EXECUTABLE_KEYS, so the one trust check
//   (`assertTrusted`, in `settings`) refuses a project-set path BEFORE any
//   module is imported; paths are resolved absolute first (serpcast's
//   `loadCodeRecipe` would resolve a relative one against the cwd).
// - Code recipes and declarative recipes share one name space: a name used
//   twice (across both kinds, or within either) is an error, never a silent
//   override, as `loadRecipes` does for duplicate JSON recipes.
// - Every listed module is imported on each search (Node's module cache makes
//   repeats cheap), since a module's engine name is only known once imported.
//
// Recorded decisions (task identity-partitioned-state-store; the store and its
// lock: state.ts):
// - Every instance gets the on-disk store of its identity's partition, keyed by
//   the SAME `serpcastIdentityKey` that keys the instance cache, so one hash
//   names both and they cannot drift apart.
// - `clearSerpcastState` without `all` clears the partition of the serpcast
//   section resolved here, whatever `backend` is selected, so a user who
//   switched backends can still drop the old sessions. A section that does not
//   resolve (no `engines`) is an error pointing at `--all`.
//
// Recorded decisions (task searchcast-fallback-and-guard; keys: config.ts,
// profile layout and idle clock: state.ts):
// - A browser engine is named `searchcast:<recipe>` in `serpcast.engines`, so
//   ONE ordered chain mixes HTTP and browser engines and the same recipe JSON
//   can run both ways (`ddg` over HTTP, `searchcast:ddg` in the browser). A
//   loaded recipe whose own name starts with `searchcast:` is an error (the
//   prefix is reserved), never a silent shadow. In library mode the recipe
//   must be a loaded declarative one (a code recipe cannot run in a browser);
//   in endpoint mode `<recipe>` is the name on the server and is not loaded
//   locally. Alternative considered: a separate `searchcast.engines` list,
//   rejected because it cannot say where in the chain the browser goes.
// - The mode is an explicit `searchcast.mode` (default `library`), so a project
//   can switch to `endpoint` while the global config keeps its chrome path;
//   library keys are then simply unused. Alternative considered: inferring the
//   mode from `endpoint` being set, rejected because a global chrome path plus
//   a project endpoint would then be ambiguous.
// - The chrome and xvfb paths and chrome args are EXECUTABLE_KEYS, checked with
//   the others whenever this backend searches (not only when a browser engine
//   is listed), like `codeRecipes`: one rule for the whole section.
// - The egress guards run only when a browser engine is listed, BEFORE
//   searchcast is imported or an instance is built: endpoint mode needs
//   `egress: direct`; library mode refuses a SOCKS URL with credentials. An
//   http proxy URL with credentials is not refused: Chromium then fails
//   closed (407), it does not leak.
// - webveil imports `searchcast` itself (the `importSearchcast` seam) before
//   building an instance that runs a library-mode engine, and hands it to
//   serpcast as `searchcast.module`: a missing package is a clear error before
//   any search, not one `transport` failure inside an exhausted chain. It is
//   resolved from webveil's location and declared as an OPTIONAL peer
//   dependency (`searchcast >=0.1.1`), so the user installs it next to webveil
//   and a strict pnpm layout still exposes it; the workspace sets
//   `autoInstallPeers: false` so it never enters the dev tree (task
//   searchcast-optional-peer-dependency).
// - A persistent profile is expired before the instance is (re)used: if the
//   partition was idle past `sessionIdleMs` (serpcast's default when unset),
//   the cached instance (and its browser) is closed first, then the profile
//   deleted, so a long-lived MCP server is covered too, not only the CLI.
//
// Recorded decisions (task refuse-proxy-overriding-chrome-args):
// - `chromeArgs` that would take the browser off `egress` are refused in
//   `browserSettings`, so whether or not a browser engine is listed and before
//   searchcast is imported, with an EgressError: it is an egress guard like
//   `assertBrowserEgress`, not a shape error.
// - The list (`EGRESS_SWITCHES`) is Chromium's proxy switches (`proxy-server`,
//   `no-proxy-server`, `proxy-bypass-list`, `proxy-pac-url`,
//   `proxy-auto-detect`, `winhttp-proxy-resolver`: chrome/common/
//   chrome_switches.cc, read into the command-line proxy config by
//   net/proxy_resolution) plus the host mapping switches, which can send a
//   hostname to another address without the proxy's DNS
//   (`host-resolver-rules`, `host-rules`: services/network/public/cpp/
//   network_switches.cc). A deny list, not an allow list: an allow list would
//   refuse the many harmless args users need.
// - A name is matched case-insensitively (Chromium lowercases switch names on
//   Windows) after one or two leading dashes, up to `=`. An argument without
//   a leading dash is positional for Chromium, not a switch, so it passes.

import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {
	createSerpcast as realCreateSerpcast,
	DEFAULT_SESSION_IDLE_MS,
	isCodeRecipe,
	loadCodeRecipe,
	SerpcastError,
} from 'serpcast';
import type {
	Engine,
	SearchcastLibraryOptions,
	SearchcastModule,
	Serpcast,
	SerpcastOptions,
} from 'serpcast';
import {loadRecipes} from 'serpcast-recipe/node';
import {resolveConfig} from '../config.js';
import type {
	Config,
	Egress,
	ResolveOptions,
	SearchcastConfig,
	SerpcastConfig,
} from '../config.js';
import {EgressError} from '../egress.js';
import {identityKey} from '../identity.js';
import {
	clearState,
	createStateStore,
	deleteProfile,
	isProfileIdle,
	partitionDir,
	profileDir,
	stateRoot,
	touchProfile,
} from '../state.js';
import {assertTrusted, resolveExecutablePath, sourceOf} from '../trust.js';
import type {Backend, SearchResult} from './types.js';

/** Test seams: how an instance is created, how searchcast is imported. */
export interface SerpcastDeps {
	createSerpcast?: (options: SerpcastOptions) => Serpcast;
	importSearchcast?: () => Promise<SearchcastModule>;
}

const EXECUTABLE_KEYS = [
	'serpcast.libcurlPath',
	'serpcast.codeRecipes',
	'serpcast.searchcast.chrome',
	'serpcast.searchcast.xvfb',
	'serpcast.searchcast.chromeArgs',
];
/** The engine-name prefix of a browser engine (see the decisions above). */
const BROWSER = 'searchcast:';
const SOCKS = ['socks5', 'socks', 'socks5h'];
/** Chromium switches that would move the browser off `egress` (see above). */
const EGRESS_SWITCHES = new Set([
	'proxy-server',
	'no-proxy-server',
	'proxy-bypass-list',
	'proxy-pac-url',
	'proxy-auto-detect',
	'winhttp-proxy-resolver',
	'host-resolver-rules',
	'host-rules',
]);
const instances = new Map<string, Serpcast>();

/** The proxy URL for serpcast: SOCKS always `socks5h` (DNS at the proxy). */
export function serpcastProxy(egress: Egress): string | undefined {
	if (egress.mode === 'direct') return undefined;
	const url = egress.url ?? '';
	const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
	const allowed = egress.mode === 'http' ? ['http', 'https'] : SOCKS;
	if (!url.includes('://') || !allowed.includes(scheme) || !URL.canParse(url))
		throw new EgressError(`egress ${egress.mode}: invalid proxy url '${url}'`);
	return egress.mode === 'http' ? url : `socks5h${url.slice(scheme.length)}`;
}

/** Resolve a path setting where it was set (never against the cwd). */
function resolvePath(config: Config, key: string, value: string): string {
	return resolveExecutablePath(value, sourceOf(config, `serpcast.${key}`));
}

const isList = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((x) => typeof x === 'string');
const num = (v: unknown) => (v === undefined ? undefined : Number(v));
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `searchcast` subsection validated, its paths resolved. */
function browserSettings(
	config: Config,
	value: unknown,
): SearchcastConfig | undefined {
	if (value === undefined) return undefined;
	const bad = (what: string) =>
		new Error(`serpcast: serpcast.searchcast${what}`);
	if (!isObject(value)) throw bad(' must be an object');
	const b = {...value} as SearchcastConfig;
	b.mode ??= 'library';
	if (b.mode !== 'library' && b.mode !== 'endpoint')
		throw bad(`.mode must be 'library' or 'endpoint'`);
	if (b.mode === 'endpoint' && (typeof b.endpoint !== 'string' || !b.endpoint))
		throw bad('.endpoint must be set in endpoint mode (a URL or socket path)');
	if (b.chromeArgs !== undefined && !isList(b.chromeArgs))
		throw bad('.chromeArgs must be a list of strings');
	for (const arg of b.chromeArgs ?? []) {
		const name = /^--?([^=]*)/.exec(arg)?.[1]!.toLowerCase();
		if (name !== undefined && EGRESS_SWITCHES.has(name))
			throw new EgressError(
				`serpcast: serpcast.searchcast.chromeArgs: '${arg}' is refused: ` +
					`--${name} would take the searchcast browser off webveil's ` +
					'egress. The browser proxy comes from `egress`: set the proxy ' +
					'there and remove this argument.',
			);
	}
	if (b.persistProfile !== undefined && typeof b.persistProfile !== 'boolean')
		throw bad('.persistProfile must be true or false');
	for (const key of ['chrome', 'xvfb'] as const) {
		if (b[key] === undefined) continue;
		if (typeof b[key] !== 'string') throw bad(`.${key} must be a path`);
		b[key] = resolvePath(config, `searchcast.${key}`, b[key]);
	}
	return b;
}

/** The section validated, its paths resolved (trust-checked first). */
function settings(config: Config): SerpcastConfig {
	assertTrusted(config, EXECUTABLE_KEYS);
	const s: SerpcastConfig = {...config.serpcast};
	if (!isList(s.engines) || s.engines.length === 0)
		throw new Error('serpcast: set serpcast.engines (engine names, in order)');
	for (const key of ['recipes', 'codeRecipes'] as const)
		if (s[key] !== undefined && !isList(s[key]))
			throw new Error(`serpcast: serpcast.${key} must be a list of paths`);
	for (const key of ['sessionIdleMs', 'cooldownMs'] as const)
		if (s[key] !== undefined && !(Number(s[key]) >= 0))
			throw new Error(`serpcast: serpcast.${key} must be a number >= 0`);
	if (s.recipes)
		s.recipes = s.recipes.map((p) => resolvePath(config, 'recipes', p));
	if (s.codeRecipes)
		s.codeRecipes = s.codeRecipes.map((p) =>
			resolvePath(config, 'codeRecipes', p),
		);
	if (s.libcurlPath)
		s.libcurlPath = resolvePath(config, 'libcurlPath', s.libcurlPath);
	const browser = browserSettings(config, s.searchcast);
	if (browser) s.searchcast = browser;
	return s;
}

/** The browser mode in use, or undefined when no browser engine is listed. */
function browserMode(s: SerpcastConfig): 'library' | 'endpoint' | undefined {
	if (!s.engines!.some((name) => name.startsWith(BROWSER))) return undefined;
	return s.searchcast?.mode ?? 'library';
}

/**
 * Refuse a browser egress webveil cannot honour (fail loud, docs/adr/0004):
 * an external endpoint behind a non-direct egress, or a SOCKS URL with
 * credentials in library mode (Chromium has no SOCKS authentication).
 */
function assertBrowserEgress(egress: Egress, mode: string | undefined): void {
	if (mode === 'endpoint' && egress.mode !== 'direct')
		throw new EgressError(
			`egress ${egress.mode}: serpcast.searchcast endpoint mode cannot be ` +
				'proxied: webveil does not run that browser, so it would reach the ' +
				'engines from wherever it runs, outside the egress (fake ' +
				'anonymity, the same trap as a local SearXNG). Use library mode ' +
				'(webveil starts searchcast with the egress as its proxy), or set ' +
				'egress=direct and proxy the searchcast server yourself (for ' +
				'example under anonctl, where the account is already forced).',
		);
	if (mode !== 'library' || egress.mode !== 'socks5') return;
	const url = URL.canParse(egress.url) ? new URL(egress.url) : undefined;
	if (url && (url.username || url.password))
		throw new EgressError(
			'egress socks5: a SOCKS proxy URL with credentials cannot be handed ' +
				'to the searchcast browser: Chromium does not support SOCKS ' +
				'authentication, so the credentials (and any circuit isolation ' +
				'they select) would be dropped. Use a SOCKS URL without ' +
				'credentials, an http egress, or endpoint mode with egress=direct.',
		);
}

/** A `searchcast:<recipe>` engine for the configured mode. */
function browserEngine(
	name: string,
	recipes: Map<string, Engine>,
	b: SearchcastConfig = {},
): Engine {
	const recipe = name.slice(BROWSER.length);
	if (!recipe) throw new Error(`serpcast: '${name}' names no recipe`);
	if (b.mode === 'endpoint')
		return {name, searchcast: {endpoint: b.endpoint!, recipe}};
	const found = recipes.get(recipe);
	if (!found || isCodeRecipe(found) || 'searchcast' in found)
		throw new Error(
			`serpcast: browser engine '${name}' needs a declarative recipe ` +
				`'${recipe}' (loaded declarative recipes: ` +
				`${
					[...recipes.values()]
						.filter((r) => !isCodeRecipe(r))
						.map((r) => r.name)
						.join(', ') || 'none'
				})`,
		);
	return {name, searchcast: {recipe: found}};
}

/** Import `searchcast` (a variable specifier: an optional package, not bundled). */
function importSearchcast(): Promise<SearchcastModule> {
	const name = 'searchcast';
	return import(name) as Promise<SearchcastModule>;
}

/** Fail loud on a recipe named like a browser engine (the prefix is reserved). */
function reserved(name: string, where: string): void {
	if (name.startsWith(BROWSER))
		throw new Error(
			`serpcast: ${where}: recipe name '${name}' uses the reserved ` +
				`'${BROWSER}' prefix (browser engines are named ${BROWSER}<recipe>)`,
		);
}

/** Every recipe by name: declarative, then code (imports, i.e. RUNS, each module). */
async function loadEngines(s: SerpcastConfig): Promise<Map<string, Engine>> {
	const engines = new Map<string, Engine>(loadRecipes(s.recipes ?? []));
	for (const name of engines.keys()) reserved(name, 'declarative recipe');
	const files = (s.codeRecipes ?? []).flatMap((p) =>
		statSync(p).isDirectory()
			? readdirSync(p)
					.sort()
					.filter((f) => /\.m?js$/.test(f))
					.map((f) => join(p, f))
			: [p],
	);
	for (const file of files) {
		const recipe = await loadCodeRecipe(file);
		reserved(recipe.name, file);
		if (engines.has(recipe.name))
			throw new Error(
				`serpcast: ${file}: duplicate recipe name '${recipe.name}'`,
			);
		engines.set(recipe.name, recipe);
	}
	return engines;
}

/** This backend's identity key (identity.ts): egress + resolved section. */
export function serpcastIdentityKey(
	config: Config,
	resolved = settings(config),
) {
	return identityKey(config.egress, resolved);
}

/**
 * Clear persisted serpcast state: the partition of the identity resolved from
 * `options` (cwd, env, global config), or with `all` every partition. Returns
 * the identity keys removed.
 */
export async function clearSerpcastState(
	options: ResolveOptions & {all?: boolean} = {},
): Promise<string[]> {
	const root = stateRoot(options.env ?? process.env, options.homeDir);
	if (options.all) return clearState(root);
	let key: string;
	try {
		key = serpcastIdentityKey(resolveConfig(options));
	} catch (error) {
		throw new Error(
			`webveil: no serpcast identity to clear here (${(error as Error).message}); use --all to clear every identity`,
			{cause: error},
		);
	}
	return clearState(root, key);
}

/** Close every cached instance (process shutdown; see registry closeBackends). */
export async function closeSerpcastInstances(): Promise<void> {
	const all = [...instances.values()];
	instances.clear();
	await Promise.allSettled(all.map((instance) => instance.close()));
}

/**
 * `serpcast.libcurlPath` trust-checked and resolved (never the cwd), without
 * the rest of the section: `web_fetch`'s serpcast transport needs only this
 * key (fetch-transport.ts), so it must not require `engines`.
 */
export function trustedLibcurlPath(config: Config): string | undefined {
	assertTrusted(config, ['serpcast.libcurlPath']);
	const lib = config.serpcast?.libcurlPath;
	if (lib === undefined) return undefined;
	if (typeof lib !== 'string')
		throw new Error('serpcast: serpcast.libcurlPath must be a path');
	return resolvePath(config, 'libcurlPath', lib);
}

/** An `impersonation` SerpcastError as an error carrying the fix (search and fetch). */
export function impersonationFailure(error: SerpcastError): Error {
	return new Error(
		`serpcast: browser impersonation is not active (${error.message}). ` +
			'Fix: run `npx serpcast install-libcurl`, or set serpcast.libcurlPath ' +
			'in the global config (or WEBVEIL_SERPCAST_LIBCURL_PATH) to a ' +
			'libcurl-impersonate library.',
		{cause: error},
	);
}

function failure(error: unknown): Error {
	if (!(error instanceof SerpcastError)) return error as Error;
	if (error.kind === 'impersonation') return impersonationFailure(error);
	if (error.kind !== 'exhausted') return error;
	const each = (error.failures ?? []).map(
		(f) => `${f.engine} (${f.error.kind}: ${f.error.message})`,
	);
	return new Error(`serpcast: every engine failed: ${each.join('; ')}`, {
		cause: error,
	});
}

/** serpcast's library-mode searchcast options (imports searchcast). */
async function libraryOptions(
	b: SearchcastConfig = {},
	persist: boolean,
	partition: string,
	deps: SerpcastDeps,
): Promise<SearchcastLibraryOptions> {
	return {
		module: await (deps.importSearchcast ?? importSearchcast)().catch(
			(cause: unknown) =>
				Promise.reject(
					new Error(
						'serpcast: a searchcast library-mode engine is listed, but the ' +
							'optional package "searchcast" is not installed (npm install ' +
							'searchcast); or use serpcast.searchcast endpoint mode',
						{cause},
					),
				),
		),
		...(b.chrome && {chrome: b.chrome}),
		...(b.xvfb && {xvfb: b.xvfb}),
		...(b.chromeArgs && {chromeArgs: b.chromeArgs}),
		...(persist && {profile: profileDir(partition)}),
	};
}

/**
 * Before a persistent profile is used: if the partition was idle past the
 * session idle time, close the cached instance (its browser) and delete the
 * profile; then mark the partition used.
 */
async function expireProfile(
	key: string,
	partition: string,
	s: SerpcastConfig,
): Promise<void> {
	const idleMs = num(s.sessionIdleMs) ?? DEFAULT_SESSION_IDLE_MS;
	if (await isProfileIdle(partition, idleMs)) {
		const stale = instances.get(key);
		instances.delete(key);
		await stale?.close();
		await deleteProfile(partition);
	}
	await touchProfile(partition);
}

/** Build the backend; everything (trust, recipes, instance) happens per search. */
export function createSerpcastBackend(
	config: Config,
	deps: SerpcastDeps = {},
): Backend {
	return {
		async search(query, _http, options = {}): Promise<SearchResult[]> {
			const s = settings(config);
			const mode = browserMode(s);
			assertBrowserEgress(config.egress, mode);
			const recipes = await loadEngines(s);
			const engines = s.engines!.map((name) => {
				if (name.startsWith(BROWSER))
					return browserEngine(name, recipes, s.searchcast);
				const recipe = recipes.get(name);
				if (recipe) return recipe;
				throw new Error(
					`serpcast: unknown engine '${name}' (loaded recipes: ` +
						`${[...recipes.keys()].join(', ') || 'none'})`,
				);
			});
			const key = serpcastIdentityKey(config, s);
			const partition = partitionDir(key);
			const persist = mode === 'library' && !!s.searchcast?.persistProfile;
			if (persist) await expireProfile(key, partition, s);
			let instance = instances.get(key);
			if (!instance) {
				const browser =
					mode === 'library'
						? await libraryOptions(s.searchcast, persist, partition, deps)
						: undefined;
				instance =
					instances.get(key) ??
					(deps.createSerpcast ?? realCreateSerpcast)({
						proxy: serpcastProxy(config.egress),
						strict: true,
						libcurlPath: s.libcurlPath,
						sessionIdleMs: num(s.sessionIdleMs),
						cooldownMs: num(s.cooldownMs),
						store: createStateStore(partition),
						...(browser && {searchcast: browser}),
					});
				instances.set(key, instance);
			}
			const answer = await instance
				.search(query, {engines, signal: options.signal})
				.catch((error: unknown) => Promise.reject(failure(error)));
			const failed = answer.failures.map((f) => f.engine);
			return answer.results.map(({title, url, snippet}) => ({
				title,
				url,
				...(snippet ? {snippet} : {}),
				...(failed.length > 0 ? {unresponsiveEngines: failed} : {}),
			}));
		},
	};
}
