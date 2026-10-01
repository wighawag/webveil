// searchcast backend: keyless search with no SearXNG. searchcast (policy-free, its
// ADR 0002) runs recipes over libcurl-impersonate; webveil injects the policy
// (docs/adr/0004): the backend-hop `egress` is searchcast's proxy, strict
// impersonation is always on, the libcurl path and code recipe paths are
// executable settings.
// searchcast owns its own I/O, so the handed `http` helper is unused (as custom).
//
// Recorded decisions (task serpcast-backend-basic; config keys: config.ts,
// identity key: identity.ts):
// - No `engines` is an error, not "every loaded recipe": the order decides which
//   engines see traffic, so it must be chosen. An unknown name is an error too.
// - An `empty` answer after failures returns [] (searchcast's genuine "no
//   results"); only `exhausted` is an error. Failed engines before an answer
//   annotate the results as `unresponsiveEngines`, as for searxng.
//
// Recorded decisions (task serpcast-code-recipes-trusted; key and env form:
// config.ts):
// - `searchcast.codeRecipes` joins EXECUTABLE_KEYS, so the one trust check
//   (`assertTrusted`, in `settings`) refuses a project-set path BEFORE any
//   module is imported; paths are resolved absolute first (searchcast's
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
//   the SAME `searchcastIdentityKey` that keys the instance cache, so one hash
//   names both and they cannot drift apart.
// - `clearSearchcastState` without `all` clears the partition of the searchcast
//   section resolved here, whatever `backend` is selected, so a user who
//   switched backends can still drop the old sessions. A section that does not
//   resolve (no `engines`) is an error pointing at `--all`.
//
// Recorded decisions (task searchcast-fallback-and-guard; keys: config.ts,
// profile layout and idle clock: state.ts):
// - A browser engine is named `searchcast:<recipe>` in `searchcast.engines`, so
//   ONE ordered chain mixes HTTP and browser engines and the same recipe JSON
//   can run both ways (`engine-a` over HTTP, `searchcast:engine-a` in the
//   browser). A loaded recipe whose own name starts with `searchcast:` is an error (the
//   prefix is reserved), never a silent shadow. In library mode the recipe
//   must be a loaded declarative one (a code recipe cannot run in a browser);
//   in endpoint mode `<recipe>` is the name on the server and is not loaded
//   locally. Alternative considered: a separate `searchcast.engines` list,
//   rejected because it cannot say where in the chain the browser goes.
// - The mode is an explicit `browser.mode` (default `library`), so a project
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
// - webveil imports `searchcast` itself (the `importBrowser` seam) before
//   building an instance that runs a library-mode engine, and hands it to
//   searchcast as `searchcast.module`: a missing package is a clear error before
//   any search, not one `transport` failure inside an exhausted chain. It is
//   resolved from webveil's location and declared as an OPTIONAL peer
//   dependency (`searchcast >=0.1.1`), so the user installs it next to webveil
//   and a strict pnpm layout still exposes it; the workspace sets
//   `autoInstallPeers: false` so it never enters the dev tree (task
//   searchcast-optional-peer-dependency).
// - A persistent profile is expired before the instance is (re)used: if the
//   partition was idle past `sessionIdleMs` (searchcast's default when unset),
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
//
// Recorded decisions (task serpcast-0-2-decoy-guard; key and env form:
// config.ts):
// - `searchcast.decoyGuard` is handed to `createSearchcast` as is. It is part of
//   the resolved section, so it joins the identity key (identity.ts): a
//   different guard is a different instance and state partition. Intended and
//   harmless (the guard changes what an engine's answer counts as, and a fresh
//   partition only costs a new session). Alternative considered: excluding it
//   from the key, rejected as a special case for no privacy gain.
// - A `decoy` failure is handled like every other engine failure: it names
//   the engine in `unresponsiveEngines`, and `failure` lists it with its kind
//   in the exhausted error. Nothing here switches on a kind other than
//   `impersonation` and `exhausted`; any other kind (a future one included)
//   passes through unchanged.
// - Connection reuse (serpcast 0.2) needs nothing here: the instance cache
//   already keeps one searchcast per identity, so reused connections never cross
//   identities, and `closeSearchcastInstances` (`close()`) releases them; idle
//   connections hold no Node handle, so the one-shot CLI still exits.
//
// Recorded decisions (task serpcast-0-5-recipes-and-nixos-docs):
// - An installed recipe set (`searchcast install-recipes`) is named in
//   `recipes` or `codeRecipes` as `set:<name>` (the whole set) or
//   `set:<name>/<file>` (one file, for a set holding helper modules that are
//   not engines), resolved to searchcast's `recipesDir()/<name>`. Alternative
//   considered: documenting only the `~/.local/share/serpcast/recipes/<set>`
//   path, rejected as the only form because it ignores `XDG_DATA_HOME`. That
//   plain path still works (below). `recipesDir()` reads `XDG_DATA_HOME` from
//   the process environment, like the state root (state.ts), never a config
//   layer, and never the cwd. A set name and a file name follow searchcast's set
//   name rule, so `..` and `/` cannot leave the set; a set that is not
//   installed is an error naming the install command, at the first search.
// - The trust rule is unchanged: `set:` is a value, the key decides. A
//   `codeRecipes` entry from a project `webveil.json` is refused whatever its
//   form; a `recipes` entry (data) may name a set from any layer.
// - A `recipes` directory that is an installed set (directly under
//   `recipesDir()`, by `set:` or by path, or holding serpcast's `.source.json`)
//   loads its `*.json` files except hidden ones (`.source.json`) and
//   `manifest.json`, which serpcast-recipe's `loadRecipes` would otherwise
//   parse as recipes and fail on. The location counts, not only the marker,
//   because a set placed declaratively (home-manager `xdg.dataFile` from
//   `fetchzip`) has no `.source.json`. Other directories load as before.
// - Recipes that declare `decoyProne` (serpcast 0.4) need nothing here:
//   searchcast guards them itself, and `decoyGuard` stays an addition.
// - The `WEBVEIL_SEARCHCAST_CODE_RECIPES` split (config.ts) keeps `set:<name>`
//   whole where the path delimiter is `:`.
//
// Recorded decisions (task webveil-installs-and-tunables; keys: config.ts,
// rules: tunables.ts):
// - searchcast's tuning options (`timeoutMs`, `maxBodyBytes`,
//   `reuseConnections`, `keepSessions`, `idlePollMs`, `maxRequestBodyBytes`,
//   `preflightCache`, `maxPreflightAgeS`, `maxRedirects`, `decoyRule`, and
//   `decoyGuard` in either form) are handed to `createSearchcast` as is, only
//   when set, so an unset key is searchcast's default. The endpoint's
//   `browser.timeoutMs`/`maxBodyBytes` go on each endpoint engine.
// - Identity key: NO key is kept out. The key names both the cached instance
//   and the state partition (decisions above: one hash, so they cannot drift
//   apart), and every one of these keys is an instance option, so a key left
//   out would let a folder reuse an instance built with another folder's
//   values. The price: changing a pure limit (a timeout) starts a fresh
//   partition, i.e. new engine sessions, which only costs a new session.
//   Unset keys are not in the key, so existing partitions keep their names.
// - `searchcast.state.persist: false` gives the instance searchcast's in-memory
//   store (`createMemoryStore`): nothing under `$XDG_STATE_HOME`, sessions
//   last as long as the process. Combined with `browser.persistProfile:
//   true` (a profile ON DISK in the partition) it is an error, not a silent
//   choice of one of the two.
// - The fix messages name webveil's own commands (`webveil install-libcurl`,
//   `webveil install-recipes`, `webveil recipes`): webveil is the only thing
//   a user installs (cli.ts).
// - `describeSearchcastEngines` (for `webveil doctor`) resolves the chain as a
//   search does, recipe loading included: listing a code recipe's engine name
//   means importing (running) it, as every search does; the trust check runs
//   first, as for a search.
//
// Recorded decisions (task move-to-searchcast-packages, serpcast renamed
// searchcast 0.2 and the browser runner renamed @searchcast/browser:
// searchcast's ADR 0005). The user-facing `serpcast` spellings (backend name,
// config section, env) were unchanged there; task rename-serpcast-spellings
// renamed them (below).
// - A `set:<name>` entry is resolved with searchcast's `recipeSetDir`: the set
//   in `$XDG_DATA_HOME/searchcast/recipes`, else in serpcast's old
//   `$XDG_DATA_HOME/serpcast/recipes` (read for one release), so a set
//   installed by serpcast keeps working. The old recipes directory counts as a
//   set location for `declarativePaths` too. The missing-set error names the
//   new directory (where `webveil install-recipes` writes).
// - Identity keys: a `set:` entry is resolved to its path before it is hashed
//   (as before), so a config naming a set now installed in the new directory
//   gets a new identity key (a fresh state partition, once); a set still read
//   from the old directory keeps its path and so its key.
// - The browser runner is imported as `@searchcast/browser` (the optional peer
//   `>=0.1.0 <0.2.0`, the range searchcast 0.2 itself accepts), and its
//   missing-package error names it and its install line. Both seams (now
//   `importBrowser` and `createSearchcast`, renamed by the rename task) hand
//   searchcast's non-deprecated API.
// - The impersonation fix message says the library usually comes with
//   searchcast (the optional platform package) and only then points at
//   `webveil install-libcurl` (or `libcurlPath`).
//
// Recorded decisions (task rename-serpcast-spellings; the old spellings and
// their warnings: spellings.ts):
// - The backend is `searchcast`, its section `searchcast.*` with the browser
//   runner's options under `searchcast.browser.*`; this module, its exports
//   and its errors follow (`createSearchcastBackend`, `searchcastIdentityKey`,
//   `searchcast: ...`). The exported `Serpcast*` names are renamed without
//   aliases: they are library API, not config, and webveil is below 1.0.
// - Identity keys do not change with the rename: `searchcastIdentityKey`
//   hashes the `browser` subsection under its 0.10 key `searchcast`, so a
//   config with browser settings keeps its state partition and browser
//   profile across the upgrade, whichever spelling it now uses. Alternative
//   considered: hashing the new shape (every identity with browser settings
//   would start a fresh partition once, and its persistent profile would be
//   orphaned until `state clear --all`).
//
// Recorded decisions (task default-backend-searchcast; the default backend:
// config.ts):
// - The DEFAULT CHAIN (`DEFAULT_ENGINES`, the bundled code recipe
//   `BUNDLED_RECIPE`, the package's `recipes/marginalia.mjs`; since task
//   default-chain-mwmbl `BUNDLED_RECIPES`, below) is filled in
//   here, in `settings`, AFTER the trust check and only when the resolved
//   section sets none of `engines`, `recipes` and `codeRecipes` (an empty
//   list counts as set, so `engines: []` is still the old error). Not in
//   config.ts DEFAULTS: the layer merge is key by key, so a user setting only
//   `recipes` would keep the default `engines` and `codeRecipes` (a merge the
//   spec rules out), and the trust check would see a code recipe path with a
//   `defaults` provenance. Filling it in here, any user engine setting
//   replaces the whole chain, and the bundled path never enters provenance,
//   so no trust rule changes: a project `webveil.json` still cannot set
//   `codeRecipes`, and cannot name the bundled file either except by setting
//   nothing. Alternative considered: a `set:`-like name for the bundled file
//   (so a user chain could mix it in); not needed for the default and a new
//   concept, left out.
// - The default chain is a searchcast section like any other: its identity
//   key hashes the bundled file's absolute path and `engines`, so
//   `clearSearchcastState` (no `--all`) clears the default chain's partition
//   in a folder with no searchcast settings, where it used to refuse.
//   `describeSearchcastEngines` (`webveil doctor`) lists it with its file.
// - The impersonation failure of `web_fetch` also names
//   `"fetchTransport": "plain"` (fetch-transport.ts): with the default
//   backend, `web_fetch` now needs the library too.
//
// Recorded decisions (task default-chain-mwmbl; owner decision 2026-09-30:
// Marginalia's keyless API was down, Mwmbl's answered):
// - The default chain is `["mwmbl", "marginalia"]` from two bundled code
//   recipes (`BUNDLED_RECIPES`, the package's `recipes/mwmbl.mjs` and
//   `recipes/marginalia.mjs`), listed file by file rather than as the
//   `recipes/` directory, so a stray file in the package can never become an
//   engine. `BUNDLED_RECIPE` (one path) became `BUNDLED_RECIPES` (a list); it
//   was never exported from the package entry, so nothing public changes.
// - The identity key of the default chain hashes the two files and the new
//   `engines`, so a user of the 0.11 default starts one fresh state partition
//   (its Marginalia cooldown and sessions are left behind; `state clear --all`
//   removes the old one). Alternative considered: pinning the old key, which
//   would make two different chains share one partition.
// - `usesDefaultSearchcastChain` is exported for `webveil doctor`
//   (setup.ts), which adds a `defaultChain` notice when this chain is in use.

import {existsSync, readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RecipeError} from '@searchcast/recipe';
import {loadRecipeFile} from '@searchcast/recipe/node';
import {
	createMemoryStore,
	createSearchcast as realCreateSearchcast,
	DEFAULT_SESSION_IDLE_MS,
	isCodeRecipe,
	loadCodeRecipe,
	oldDataDir,
	recipeSetDir,
	recipesDir,
	SearchcastError,
} from 'searchcast';
import type {
	Engine,
	Searchcast,
	SearchcastLibraryOptions,
	SearchcastModule,
	SearchcastOptions,
} from 'searchcast';
import {resolveConfig} from '../config.js';
import type {
	Config,
	Egress,
	ResolveOptions,
	BrowserConfig,
	SearchcastConfig,
} from '../config.js';
import {EgressError} from '../egress.js';
import {identityKey} from '../identity.js';
import {reportDeprecations} from '../spellings.js';
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
import {checkSearchcastTunables} from '../tunables.js';
import {assertTrusted, resolveExecutablePath, sourceOf} from '../trust.js';
import type {Backend, SearchResult} from './types.js';

/** Test seams: how an instance is created, how searchcast is imported. */
export interface SearchcastDeps {
	createSearchcast?: (options: SearchcastOptions) => Searchcast;
	importBrowser?: () => Promise<SearchcastModule>;
}

const EXECUTABLE_KEYS = [
	'searchcast.libcurlPath',
	'searchcast.codeRecipes',
	'searchcast.browser.chrome',
	'searchcast.browser.xvfb',
	'searchcast.browser.chromeArgs',
];
/** The engine-name prefix of a browser engine (see the decisions above). */
const BROWSER = 'searchcast:';
/** The prefix of an installed recipe set entry in `recipes`/`codeRecipes`. */
const SET = 'set:';
/** What `install-recipes` writes beside a set's recipes. */
const SOURCE_FILE = '.source.json';
/**
 * Where installed sets live: searchcast's recipes directory, then searchcast's
 * old one (read, never written, for one release: searchcast's ADR 0005).
 */
const SET_BASES = () => [recipesDir(), join(oldDataDir(), 'recipes')];
/** The optional browser-runner package library-mode engines need. */
const BROWSER_PACKAGE = '@searchcast/browser';
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
const instances = new Map<string, Searchcast>();

/** The package's `recipes/` directory (three levels above both `src/core/backends/` and `dist/core/backends/`). */
const bundled = (file: string) =>
	fileURLToPath(new URL(`../../../recipes/${file}`, import.meta.url));

/**
 * The code recipes of the default chain, shipped in the webveil package
 * (`recipes/mwmbl.mjs` and `recipes/marginalia.mjs`, copies of searchcast's
 * examples). Trusted because they ship with webveil.
 */
export const BUNDLED_RECIPES: readonly string[] = [
	bundled('mwmbl.mjs'),
	bundled('marginalia.mjs'),
];
/** The default engine chain: the bundled recipes' engines, in order. */
export const DEFAULT_ENGINES: readonly string[] = ['mwmbl', 'marginalia'];

/**
 * What `webveil doctor` says while the default chain is in use: a notice, not
 * a problem (the default works), pointing to recipes.
 */
export const DEFAULT_CHAIN_NOTE =
	'the default engine chain is in use (mwmbl, then marginalia: two small ' +
	'independent indexes through their keyless public APIs, with per-IP ' +
	'quotas). It is a floor: webveil does much more with recipes (any ' +
	"site's search as an engine, code recipes, a browser fallback). Install " +
	'a recipe set with `webveil install-recipes <url> --sha256 <hex>` or ' +
	'write your own: https://github.com/wighawag/webveil#the-default-engines-and-what-recipes-add';

/** True when the section configures no engine chain at all (the default applies). */
function usesDefaultChain(s: SearchcastConfig): boolean {
	return (
		s.engines === undefined &&
		s.recipes === undefined &&
		s.codeRecipes === undefined
	);
}

/**
 * True when a search with `config` runs the bundled default chain: the
 * searchcast backend, and no engines, recipes or code recipes set anywhere.
 */
export function usesDefaultSearchcastChain(config: Config): boolean {
	return (
		config.backend === 'searchcast' && usesDefaultChain(config.searchcast ?? {})
	);
}

/** The proxy URL for searchcast: SOCKS always `socks5h` (DNS at the proxy). */
export function searchcastProxy(egress: Egress): string | undefined {
	if (egress.mode === 'direct') return undefined;
	const url = egress.url ?? '';
	const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
	const allowed = egress.mode === 'http' ? ['http', 'https'] : SOCKS;
	if (!url.includes('://') || !allowed.includes(scheme) || !URL.canParse(url))
		throw new EgressError(`egress ${egress.mode}: invalid proxy url '${url}'`);
	return egress.mode === 'http' ? url : `socks5h${url.slice(scheme.length)}`;
}

/** The name rule of an installed set, and of a file in one (no `/`, no `..`). */
const SET_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * An installed recipe set entry (`set:<name>` or `set:<name>/<file>`) as its
 * path under searchcast's `recipeSetDir` (the user's data directory, else
 * serpcast's old one for one release; never the cwd), or undefined when
 * `value` is not one.
 */
function installedSetPath(value: string): string | undefined {
	if (!value.startsWith(SET)) return undefined;
	const parts = value.slice(SET.length).split('/');
	if (parts.length > 2 || !parts.every((p) => SET_PART.test(p)))
		throw new Error(
			`searchcast: '${value}' is not an installed recipe set entry ` +
				'(set:<name> or set:<name>/<file>)',
		);
	const dir = recipeSetDir(parts[0]!);
	if (!dir)
		throw new Error(
			`searchcast: recipe set '${parts[0]}' is not installed in ` +
				`${recipesDir()} (install it with \`webveil install-recipes ` +
				'<archive> --sha256 <hex>`; `webveil recipes` shows the installed ' +
				'sets)',
		);
	return parts[1] ? join(dir, parts[1]) : dir;
}

/** Resolve a path setting where it was set (never against the cwd). */
function resolvePath(config: Config, key: string, value: string): string {
	return resolveExecutablePath(value, sourceOf(config, `searchcast.${key}`));
}

/** A `recipes`/`codeRecipes` entry: an installed set entry, else a path. */
function resolveRecipePath(config: Config, key: string, value: string): string {
	return installedSetPath(value) ?? resolvePath(config, key, value);
}

/**
 * A `recipes` entry as its recipe files: a file as is, a directory as every
 * `*.json` inside, sorted (@searchcast/recipe's `loadRecipes` rule); an
 * installed set directory (directly under `recipesDir()` or serpcast's old
 * recipes directory, or holding the installer's `.source.json`) without
 * hidden files (`.source.json`) and the set's `manifest.json`, which are not
 * recipes.
 */
function declarativePaths(path: string): string[] {
	if (!statSync(path).isDirectory()) return [path];
	const isSet =
		SET_BASES().includes(dirname(path)) || existsSync(join(path, SOURCE_FILE));
	return readdirSync(path)
		.sort()
		.filter((f) => f.endsWith('.json'))
		.filter((f) => !isSet || (!f.startsWith('.') && f !== 'manifest.json'))
		.map((f) => join(path, f));
}

const isList = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((x) => typeof x === 'string');
const num = (v: unknown) => (v === undefined ? undefined : Number(v));
/** `{[key]: value}` when `value` is set, else nothing (spread into options). */
const pick = <T extends object>(from: T, keys: (keyof T)[]): Partial<T> =>
	Object.fromEntries(
		keys.filter((k) => from[k] !== undefined).map((k) => [k, from[k]]),
	) as Partial<T>;
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `browser` subsection validated, its paths resolved. */
function browserSettings(
	config: Config,
	value: unknown,
): BrowserConfig | undefined {
	if (value === undefined) return undefined;
	const bad = (what: string) =>
		new Error(`searchcast: searchcast.browser${what}`);
	if (!isObject(value)) throw bad(' must be an object');
	const b = {...value} as BrowserConfig;
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
				`searchcast: searchcast.browser.chromeArgs: '${arg}' is refused: ` +
					`--${name} would take the searchcast browser off webveil's ` +
					'egress. The browser proxy comes from `egress`: set the proxy ' +
					'there and remove this argument.',
			);
	}
	if (b.persistProfile !== undefined && typeof b.persistProfile !== 'boolean')
		throw bad('.persistProfile must be true or false');
	if (b.persistProfile && config.searchcast?.state?.persist === false)
		throw bad(
			'.persistProfile keeps the browser profile on disk, but ' +
				'searchcast.state.persist is false (nothing on disk): set one of them',
		);
	for (const key of ['chrome', 'xvfb'] as const) {
		if (b[key] === undefined) continue;
		if (typeof b[key] !== 'string') throw bad(`.${key} must be a path`);
		b[key] = resolvePath(config, `browser.${key}`, b[key]);
	}
	return b;
}

/** The section validated, its paths resolved (trust-checked first). */
function settings(config: Config): SearchcastConfig {
	assertTrusted(config, EXECUTABLE_KEYS);
	const s: SearchcastConfig = {...config.searchcast};
	const fallback = usesDefaultChain(s);
	if (fallback) s.engines = [...DEFAULT_ENGINES];
	if (!isList(s.engines) || s.engines.length === 0)
		throw new Error(
			'searchcast: set searchcast.engines (engine names, in order)',
		);
	for (const key of ['recipes', 'codeRecipes'] as const)
		if (s[key] !== undefined && !isList(s[key]))
			throw new Error(`searchcast: searchcast.${key} must be a list of paths`);
	checkSearchcastTunables(s as Record<string, unknown>);
	if (s.recipes)
		s.recipes = s.recipes.map((p) => resolveRecipePath(config, 'recipes', p));
	if (s.codeRecipes)
		s.codeRecipes = s.codeRecipes.map((p) =>
			resolveRecipePath(config, 'codeRecipes', p),
		);
	// Added after the paths are resolved: it is already absolute, and it has no
	// config source to resolve against (see the decisions above).
	if (fallback) s.codeRecipes = [...BUNDLED_RECIPES];
	if (s.libcurlPath)
		s.libcurlPath = resolvePath(config, 'libcurlPath', s.libcurlPath);
	const browser = browserSettings(config, s.browser);
	if (browser) s.browser = browser;
	return s;
}

/** The browser mode in use, or undefined when no browser engine is listed. */
function browserMode(s: SearchcastConfig): 'library' | 'endpoint' | undefined {
	if (!s.engines!.some((name) => name.startsWith(BROWSER))) return undefined;
	return s.browser?.mode ?? 'library';
}

/**
 * Refuse a browser egress webveil cannot honour (fail loud, docs/adr/0004):
 * an external endpoint behind a non-direct egress, or a SOCKS URL with
 * credentials in library mode (Chromium has no SOCKS authentication).
 */
function assertBrowserEgress(egress: Egress, mode: string | undefined): void {
	if (mode === 'endpoint' && egress.mode !== 'direct')
		throw new EgressError(
			`egress ${egress.mode}: searchcast.browser endpoint mode cannot be ` +
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
	b: BrowserConfig = {},
): Engine {
	const recipe = name.slice(BROWSER.length);
	if (!recipe) throw new Error(`searchcast: '${name}' names no recipe`);
	if (b.mode === 'endpoint')
		return {
			name,
			searchcast: {
				endpoint: b.endpoint!,
				recipe,
				...pick(b, ['timeoutMs', 'maxBodyBytes']),
			},
		};
	const found = recipes.get(recipe);
	if (!found || isCodeRecipe(found) || 'searchcast' in found)
		throw new Error(
			`searchcast: browser engine '${name}' needs a declarative recipe ` +
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

/**
 * Import the browser runner `@searchcast/browser` (a variable specifier: an
 * optional package, not bundled).
 */
function importBrowser(): Promise<SearchcastModule> {
	const name = BROWSER_PACKAGE;
	return import(name) as Promise<SearchcastModule>;
}

/** Fail loud on a recipe named like a browser engine (the prefix is reserved). */
function reserved(name: string, where: string): void {
	if (name.startsWith(BROWSER))
		throw new Error(
			`searchcast: ${where}: recipe name '${name}' uses the reserved ` +
				`'${BROWSER}' prefix (browser engines are named ${BROWSER}<recipe>)`,
		);
}

/**
 * Every recipe by name: declarative, then code (imports, i.e. RUNS, each
 * module). `files` (when given) receives each recipe's file.
 */
async function loadEngines(
	s: SearchcastConfig,
	files = new Map<string, string>(),
): Promise<Map<string, Engine>> {
	const engines = new Map<string, Engine>();
	for (const file of (s.recipes ?? []).flatMap(declarativePaths)) {
		const recipe = loadRecipeFile(file);
		if (engines.has(recipe.name))
			throw new RecipeError(`${file}: duplicate recipe name "${recipe.name}"`);
		engines.set(recipe.name, recipe);
		files.set(recipe.name, file);
	}
	for (const name of engines.keys()) reserved(name, 'declarative recipe');
	const modules = (s.codeRecipes ?? []).flatMap((p) =>
		statSync(p).isDirectory()
			? readdirSync(p)
					.sort()
					.filter((f) => /\.m?js$/.test(f))
					.map((f) => join(p, f))
			: [p],
	);
	for (const file of modules) {
		const recipe = await loadCodeRecipe(file);
		reserved(recipe.name, file);
		if (engines.has(recipe.name))
			throw new Error(
				`searchcast: ${file}: duplicate recipe name '${recipe.name}'`,
			);
		engines.set(recipe.name, recipe);
		files.set(recipe.name, file);
	}
	return engines;
}

/** The chain's engines, in order, from the loaded recipes (errors on an unknown name). */
function chain(s: SearchcastConfig, recipes: Map<string, Engine>): Engine[] {
	return s.engines!.map((name) => {
		if (name.startsWith(BROWSER))
			return browserEngine(name, recipes, s.browser);
		const recipe = recipes.get(name);
		if (recipe) return recipe;
		throw new Error(
			`searchcast: unknown engine '${name}' (loaded recipes: ` +
				`${[...recipes.keys()].join(', ') || 'none'})`,
		);
	});
}

/** One engine of the chain as `webveil doctor` lists it. */
export interface EngineDescription {
	name: string;
	kind: 'declarative' | 'code' | 'browser';
	/** The recipe file (a browser engine: its recipe's file, in library mode). */
	file?: string;
}

/**
 * The configured chain resolved as a search would (trust check, recipe
 * loading, engine names), each engine with its kind and recipe file. For
 * `webveil doctor`; throws what a search would throw.
 */
export async function describeSearchcastEngines(
	config: Config,
): Promise<EngineDescription[]> {
	const s = settings(config);
	const files = new Map<string, string>();
	const recipes = await loadEngines(s, files);
	return chain(s, recipes).map((engine): EngineDescription => {
		if ('searchcast' in engine) {
			const recipe = engine.name.slice(BROWSER.length);
			const file = files.get(recipe);
			return {
				name: engine.name,
				kind: 'browser',
				...(s.browser?.mode !== 'endpoint' && file && {file}),
			};
		}
		const kind = isCodeRecipe(engine) ? 'code' : 'declarative';
		return {name: engine.name, kind, file: files.get(engine.name)!};
	});
}

/**
 * This backend's identity key (identity.ts): egress + resolved section, the
 * `browser` subsection hashed under its webveil 0.10 name `searchcast` so the
 * rename keeps every identity key (see the decisions above).
 */
export function searchcastIdentityKey(
	config: Config,
	resolved = settings(config),
) {
	const {browser, ...section} = resolved;
	return identityKey(
		config.egress,
		browser === undefined ? section : {...section, searchcast: browser},
	);
}

/**
 * Clear persisted searchcast state: the partition of the identity resolved from
 * `options` (cwd, env, global config), or with `all` every partition. Returns
 * the identity keys removed.
 */
export async function clearSearchcastState(
	options: ResolveOptions & {
		all?: boolean;
		onWarning?: (message: string) => void;
	} = {},
): Promise<string[]> {
	const root = stateRoot(options.env ?? process.env, options.homeDir);
	if (options.all) return clearState(root);
	let key: string;
	let s: SearchcastConfig;
	try {
		const config = resolveConfig(options);
		reportDeprecations(config, options.onWarning);
		s = settings(config);
		key = searchcastIdentityKey(config, s);
	} catch (error) {
		throw new Error(
			`webveil: no searchcast identity to clear here (${(error as Error).message}); use --all to clear every identity`,
			{cause: error},
		);
	}
	return clearState(root, key, {
		staleMs: s.state?.lockStaleMs,
		waitMs: s.state?.lockWaitMs,
	});
}

/** Close every cached instance (process shutdown; see registry closeBackends). */
export async function closeSearchcastInstances(): Promise<void> {
	const all = [...instances.values()];
	instances.clear();
	await Promise.allSettled(all.map((instance) => instance.close()));
}

/**
 * `searchcast.libcurlPath` trust-checked and resolved (never the cwd), without
 * the rest of the section: `web_fetch`'s searchcast transport needs only this
 * key (fetch-transport.ts), so it must not require `engines`.
 */
export function trustedLibcurlPath(config: Config): string | undefined {
	assertTrusted(config, ['searchcast.libcurlPath']);
	const lib = config.searchcast?.libcurlPath;
	if (lib === undefined) return undefined;
	if (typeof lib !== 'string')
		throw new Error('searchcast: searchcast.libcurlPath must be a path');
	return resolvePath(config, 'libcurlPath', lib);
}

/** An `impersonation` SearchcastError as an error carrying the fix (search and fetch). */
export function impersonationFailure(
	error: SearchcastError,
	caller: 'search' | 'fetch' = 'search',
): Error {
	const plain =
		caller === 'fetch'
			? ' Or set "fetchTransport": "plain" to fetch pages with Node\'s own ' +
				'TLS fingerprint instead (never done silently).'
			: '';
	return new Error(
		`searchcast: browser impersonation is not active (${error.message}). ` +
			'On most platforms searchcast brings the library as its optional ' +
			'dependency @searchcast/libcurl-<platform>. Fix: reinstall webveil ' +
			'with optional dependencies enabled; where that is not possible (or ' +
			'the platform has no such package), run `webveil install-libcurl`, ' +
			'or set searchcast.libcurlPath in the global config (or ' +
			'WEBVEIL_SEARCHCAST_LIBCURL_PATH) to a libcurl-impersonate library.' +
			plain,
		{cause: error},
	);
}

function failure(error: unknown): Error {
	if (!(error instanceof SearchcastError)) return error as Error;
	if (error.kind === 'impersonation') return impersonationFailure(error);
	if (error.kind !== 'exhausted') return error;
	const each = (error.failures ?? []).map(
		(f) => `${f.engine} (${f.error.kind}: ${f.error.message})`,
	);
	return new Error(`searchcast: every engine failed: ${each.join('; ')}`, {
		cause: error,
	});
}

/** searchcast's library-mode searchcast options (imports searchcast). */
async function libraryOptions(
	b: BrowserConfig = {},
	persist: boolean,
	partition: string,
	deps: SearchcastDeps,
): Promise<SearchcastLibraryOptions> {
	return {
		module: await (deps.importBrowser ?? importBrowser)().catch(
			(cause: unknown) =>
				Promise.reject(
					new Error(
						'searchcast: a searchcast library-mode engine is listed, but the ' +
							`optional package "${BROWSER_PACKAGE}" (the browser runner) ` +
							`is not installed (npm install ${BROWSER_PACKAGE}, next to ` +
							'webveil); or use searchcast.browser endpoint mode',
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
	s: SearchcastConfig,
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
export function createSearchcastBackend(
	config: Config,
	deps: SearchcastDeps = {},
): Backend {
	return {
		async search(query, _http, options = {}): Promise<SearchResult[]> {
			const s = settings(config);
			const mode = browserMode(s);
			assertBrowserEgress(config.egress, mode);
			const engines = chain(s, await loadEngines(s));
			const key = searchcastIdentityKey(config, s);
			const partition = partitionDir(key);
			const persist = mode === 'library' && !!s.browser?.persistProfile;
			if (persist) await expireProfile(key, partition, s);
			let instance = instances.get(key);
			if (!instance) {
				const browser =
					mode === 'library'
						? await libraryOptions(s.browser, persist, partition, deps)
						: undefined;
				instance =
					instances.get(key) ??
					(deps.createSearchcast ?? realCreateSearchcast)({
						proxy: searchcastProxy(config.egress),
						strict: true,
						libcurlPath: s.libcurlPath,
						sessionIdleMs: num(s.sessionIdleMs),
						cooldownMs: num(s.cooldownMs),
						...pick(s, [
							'timeoutMs',
							'maxBodyBytes',
							'reuseConnections',
							'keepSessions',
							'idlePollMs',
							'maxRequestBodyBytes',
							'preflightCache',
							'maxPreflightAgeS',
							'maxRedirects',
							'decoyRule',
							'decoyGuard',
						]),
						store:
							s.state?.persist === false
								? createMemoryStore()
								: createStateStore(partition, {
										lock: {
											staleMs: s.state?.lockStaleMs,
											waitMs: s.state?.lockWaitMs,
										},
									}),
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
