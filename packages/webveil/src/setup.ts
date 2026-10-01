// setup: the four commands that make webveil the only thing a user installs
// (`install-libcurl`, `install-recipes`, `recipes`, `doctor`), wrapping
// searchcast's install API. The installers live on searchcast's separate
// `searchcast/install` entry, which this module imports LAZILY (`loadInstallApi`),
// only when one of these commands runs: `search`, `fetch` and everything they
// import never load download code (test/setup.test.ts walks the imports).
//
// Recorded decisions (task webveil-installs-and-tunables):
// - CLI only. None of the four is an MCP tool (cli.ts builds the `--mcp`
//   server without them) or a pi tool (pi-webveil registers web_search and
//   web_fetch only). The installers download code (the library webveil loads,
//   recipes it may import), and the pin is the human's trust decision, not an
//   agent's. `recipes` and `doctor` download nothing but are setup and
//   diagnosis steps for the human, and would put local paths and hashes into
//   an agent's context; an agent already gets the fix inside the error of a
//   failed search. Alternative considered: exposing the two read-only ones.
//   The `--llms` manifest and `skills add` still describe them: they document
//   the CLI, and an agent with a shell can run any program anyway.
// - `--proxy` defaults to NOTHING (a direct download), never to the
//   configured `egress`: where a download goes is the user's decision at the
//   moment they type it, and a silent egress could be the wrong one (a
//   per-folder egress picked up from the cwd). The help says how to route it.
//
// Recorded decisions (task install-route-explicit-under-proxy-egress, owner
// decision 2026-09-30, refining the one above): a download's route is never
// GUESSED either way. When the config `search` would resolve here has a
// non-direct egress, a direct download would tell the host (GitHub) that this
// IP installed webveil's library or a recipe set, so the installers refuse
// (`downloadRoute`, exit 2 before any request) until the user types
// `--proxy <url>` or `--direct`. Still never the egress silently.
// - Which egress counts: EITHER hop. The backend-hop `egress` or a set
//   `fetchEgress` that is not direct means the user wants that traffic off
//   their IP, so either one requires the explicit choice. Alternative
//   considered: the backend hop only (a local SearXNG with a proxied
//   `web_fetch` would then download directly without a word).
// - The suggested `--proxy` value is the hop's proxy mapped as webveil hands
//   it to searchcast (`searchcastProxy`: SOCKS as `socks5h://`), egress first,
//   then a different fetchEgress; with its credentials REDACTED (`***`), since
//   the message may land in a terminal log or a paste. The user puts them back.
//   Alternative considered: printing the credentials so it is truly
//   paste-ready (rejected: a secret in an error message).
// - The config is resolved only when neither flag is given, so `--proxy` or
//   `--direct` works even in a folder whose config does not parse. Without a
//   flag, a config error is the command's error (as it would be for `search`).
// - `--proxy` with `--direct` is a usage error (exit 2) whatever the egress
//   and whatever the source. A local file for `install-recipes` makes no
//   request, so no route is required there (`--direct` is accepted and
//   ignored; `--proxy` stays searchcast's own error for a file).
// - Exit code 2 with error codes `ROUTE_REQUIRED` and `CONFLICTING_OPTIONS`,
//   the convention for a usage error; the other failures keep exit 1.
//   `doctor --remote` is unchanged: it already goes through the egress.
//
// Recorded decisions (task install-egress-flag, owner request 2026-09-30):
// `--egress` is a third explicit route: download through the egress webveil
// already has configured, resolved as `search` resolves it (cwd, project,
// global, env) and mapped as for searchcast (`searchcastProxy`: SOCKS as
// `socks5h://`, `http` as is), credentials USED but never printed (progress
// and errors show the redacted form). It stays explicit: the refusal above
// still happens without a flag, and now offers `--egress` first (the likely
// intent; unlike the pasted `--proxy` suggestion it keeps the credentials).
// - Which hop (`egressRoute`): the backend-hop `egress` when it is a proxy;
//   else a proxy `fetchEgress` (then the only proxied hop). When both are
//   proxies and differ, `egress` wins and the progress line names the unused
//   `fetchEgress`. Alternatives considered: the fetch hop first (downloads are
//   plain GETs, like `web_fetch`), or refusing the ambiguous case. Rejected:
//   `egress` is THE egress of the config (fetchEgress is its per-hop
//   override, docs/adr/0003), so it is what "the configured egress" names,
//   and `--proxy <url>` remains for the other hop. Note `doctor --remote`
//   picks its hop by the backend instead (it checks the library's hop); a
//   download uses no library, so that rule does not apply here.
// - Every hop direct: `--egress` is a plain direct download, announced on the
//   progress sink, not an error (the user asked for "whatever my egress is").
// - Not buildable (`downloadProxy`): an egress URL `searchcastProxy` rejects, or
//   an `https://` http proxy (searchcast accepts it for search, but its
//   downloader takes only http://, socks5:// and socks5h://), fails loud
//   before any request with an `EgressError` (exit 1, like a `search` whose
//   egress cannot be built), never a silent fallback to direct.
// - `--egress` with `--proxy` or `--direct` is `CONFLICTING_OPTIONS` (exit 2).
//   A local file for `install-recipes`: `--egress` is accepted and ignored,
//   like `--direct`, and the config is not resolved.
//
// Recorded decisions (task install-recipes-from-ipfs, searchcast 0.4):
// - An `ipfs://<cid>[/<path>]` source is a DOWNLOAD like an http(s) URL: the
//   same explicit-route rule (`--egress` / `--proxy` / `--direct`, refused
//   without one under a proxy egress), and searchcast sends every gateway
//   request through that proxy (a loopback gateway too). Unchanged otherwise.
// - `--sha256` is optional for `ipfs://` (the CID pins it; searchcast checks
//   it against an IPFS archive when given, and refuses it for an IPFS set
//   directory). For any other source its absence is now webveil's
//   `UsageError` `SHA256_REQUIRED` (exit 2, before anything is resolved or
//   loaded), no longer incur's `VALIDATION_ERROR` (exit 1): the option had to
//   become optional in the schema, and exit 2 is this module's convention for
//   a usage error. Alternative considered: leaving it to searchcast's
//   InstallError (exit 1), rejected because the route would be resolved
//   (and could be refused) before the real problem was named.
// - Gateways: `--ipfs-gateway` (repeatable) wins whole; else
//   `searchcast.ipfsGateways` (config.ts: any layer, env
//   `WEBVEIL_SEARCHCAST_IPFS_GATEWAYS`), announced on the progress sink with
//   the layer that set it; else searchcast's `DEFAULT_IPFS_GATEWAYS`. The
//   configured ones are passed for an `ipfs://` source ONLY (searchcast
//   refuses gateways for any other source); typed ones are passed as typed,
//   so `--ipfs-gateway` with a URL or file stays searchcast's own error, like
//   `--proxy` with a file.
// - For an `ipfs://` source without `--ipfs-gateway`, the config is resolved
//   for the gateways even with `--proxy` or `--direct`, so there (only) a
//   folder whose config does not parse fails the command; `--ipfs-gateway`
//   avoids it. One lazy resolution serves the route and the gateways.
// - `recipes` shows an IPFS set's `source` (the ipfs:// URL), `cid` and
//   `gateway` (whose CAR verified), and `sha256` only when `.source.json`
//   has one (absent for an IPFS set directory). `doctor` adds each installed
//   `set:` entry's `source`.
//
// Recorded decisions (task ipfs-install-suggestions, searchcast 0.4.2): an
// `ipfs://` directory that cannot be a recipe set is refused by searchcast
// with `InstallError.suggestions`; webveil rethrows it (same class, so the
// exit code and error code are unchanged; `cause` and `suggestions` kept)
// with webveil commands instead of searchcast's, so the user is never told
// to run searchcast directly, outside webveil's egress (`notASetMessage`).
// - Kept: searchcast's listing, the message up to its LAST ". Try: " (an
//   entry name could hold that text, a suggested URL cannot: it is
//   percent-encoded); a generic "<source> is not a recipe set" if it is not
//   found, so "searchcast install-recipes" is never printed. Alternative:
//   rebuilding the listing (searchcast does not expose the entry names).
// - Repeated per command, as typed: the route flag (`--egress`, `--direct`,
//   or `--proxy <url>` as a PLACEHOLDER, never the typed URL, which may hold
//   credentials, with a line saying to put it back), each `--ipfs-gateway`
//   (a gateway base URL carries no credentials, searchcast refuses them),
//   `--name` and `--force`; `--sha256` only from the suggestion (searchcast
//   keeps it on archive suggestions only). No route flag typed (a direct
//   egress) means none suggested: the user's command worked without one.
//   Configured gateways are not repeated (the config gives them again).
//   Alternative considered: suggesting the configured `--egress` whenever
//   the egress is a proxy (rejected: the user already chose the route).
// - Each command on its own line, its kind as a trailing shell comment
//   (`# a release archive`), so a line pastes as is; a value with any
//   character outside `[\w@%+=:,./-]` is single-quoted for the shell.
// - Any other error, or this refusal without suggestions, is unchanged.
//
// - No `--dir` for `install-recipes`: webveil resolves `set:<name>` in
//   searchcast's recipes directory only (backends/searchcast.ts), so a set
//   installed elsewhere could not be named. The plain searchcast CLI still has
//   it for other uses.
// - `recipes` is a single command listing the installed sets (the task's
//   spelling), not searchcast's `recipes list` group.
// - `doctor`: searchcast's report for the library webveil would load (its
//   trusted `searchcast.libcurlPath`, else searchcast's own lookup), plus
//   webveil's view of the current folder's config: backend, both egress hops
//   (credentials redacted), the fetch transport, the engine chain resolved to
//   recipe files, and each configured `set:` entry. It is healthy when
//   impersonation is active (only required when the backend or the fetch
//   transport is searchcast, the only users of the library) and nothing in
//   webveil's view failed. `--remote` asks searchcast's echo service once,
//   through the searchcast backend's `egress` when that is the backend, else
//   through the fetch hop's egress (the hop that uses the library then).
// - Progress lines go to stderr as searchcast's CLI prints them; the result is
//   the command's output (TOON or JSON, as for every webveil command).
//
// Recorded decisions (task move-to-searchcast-packages, serpcast renamed
// searchcast 0.2, searchcast's ADR 0005):
// - The installers write only to searchcast's data directory
//   (`$XDG_DATA_HOME/searchcast`): they are searchcast's own installers, which
//   never write to serpcast's old one. Reading falls back to the old one for
//   one release, as searchcast does (`recipeSetDir`, the library lookup).
// - `doctor` shows searchcast's old-data-dir notice (`oldDataDirHits`: what is
//   still read from `$XDG_DATA_HOME/serpcast`, with the `mv` command) as a
//   top-level `oldDataDir` field, not inside `libcurl`: it covers recipe sets
//   too, and it is shown whatever the backend. It is a notice, not a problem:
//   it does not make doctor unhealthy (the old directory still works for one
//   release). Alternative considered: counting it as a problem, rejected
//   because doctor would then fail on a working setup.
// - `recipes` lists the sets still in the old directory as `oldSets` (with
//   `used`: false when a set of the same name in the new directory shadows
//   it), mirroring `searchcast recipes list`; absent when there are none.
// - A `set:` entry in `doctor` is resolved with `recipeSetDir` (new directory,
//   then old), as a search resolves it (backends/searchcast.ts).
//
// Recorded decisions (task rename-serpcast-spellings; spellings.ts):
// - `doctor` lists the deprecated `serpcast` spellings of this folder's
//   config as a top-level `deprecations` field and does not print them: like
//   `oldDataDir`, a notice, not a problem (the old spellings still work for
//   one release), so doctor stays healthy. The install commands print them on
//   their progress sink (`log`) when they resolve the config.
//
// Recorded decision (task default-backend-searchcast; config.ts): while the
// backend is the built-in default, `doctor` adds a top-level `defaultBackend`
// notice (the default changed; `backend: "searxng"` restores it). Like
// `deprecations`, a notice, not a problem: the default works, so doctor stays
// healthy.
//
// Recorded decision (task default-chain-mwmbl): while the searchcast backend
// runs the bundled default chain, `doctor` adds a top-level `defaultChain`
// notice (`DEFAULT_CHAIN_NOTE`: the chain is a floor, recipes are the
// product, and where to start). A notice beside `defaultBackend`, not merged
// into it: `defaultBackend` is about the backend changing and disappears once
// `backend` is set, while the default chain stays in use with an explicit
// `backend: "searchcast"` and no engines. Not a problem, so doctor stays
// healthy. Alternative considered: printing it on every search, rejected as
// noise (the README carries the message for new users).

import {dirname, join} from 'node:path';
import type {DoctorReport, OldDataDirHits, RecipeSet} from 'searchcast/install';
import {
	DEFAULT_BACKEND_NOTE,
	resolveConfig as realResolveConfig,
	usesDefaultBackend,
} from './core/config.js';
import type {Config, Egress, ResolveOptions} from './core/config.js';
import {EgressError, fetchEgressConfig} from './core/egress.js';
import {resolveFetchTransport} from './core/fetch-transport.js';
import {configDeprecations, reportDeprecations} from './core/spellings.js';
import {sourceOf} from './core/trust.js';
import {
	DEFAULT_CHAIN_NOTE,
	describeSearchcastEngines,
	searchcastProxy,
	trustedLibcurlPath,
	usesDefaultSearchcastChain,
} from './core/backends/searchcast.js';
import type {EngineDescription} from './core/backends/searchcast.js';

/** searchcast's install API (the `searchcast/install` entry). */
export type InstallApi = typeof import('searchcast/install');

/** Import `searchcast/install`: the only place download code is loaded. */
export function loadInstallApi(): Promise<InstallApi> {
	return import('searchcast/install');
}

/** Seams: the install API, the progress sink, and config resolution. */
export interface SetupDeps {
	loadInstall?: () => Promise<InstallApi>;
	log?: (line: string) => void;
	resolveConfig?: (options?: ResolveOptions) => Config;
}

const stderr = (line: string) => void process.stderr.write(`${line}\n`);

/** How a download leaves: `--proxy <url>`, `--direct`, or `--egress`. */
export interface RouteOptions {
	proxy?: string;
	direct?: boolean;
	egress?: boolean;
}

/**
 * A usage error of an install command (exit 2): raised before anything is
 * loaded or downloaded.
 */
export class UsageError extends Error {
	readonly exitCode = 2;
	constructor(
		readonly code: 'ROUTE_REQUIRED' | 'CONFLICTING_OPTIONS' | 'SHA256_REQUIRED',
		message: string,
	) {
		super(message);
		this.name = 'UsageError';
	}
}

/** A hop's proxy as `--proxy` takes it (SOCKS as `socks5h://`), redacted. */
function suggestedProxy(egress: Egress): string {
	let proxy: string;
	try {
		proxy = searchcastProxy(egress) ?? '';
	} catch {
		proxy = egress.mode === 'direct' ? '' : (egress.url ?? '');
	}
	return redactUrl(proxy);
}

/** Two of `--proxy`, `--direct`, `--egress` is a usage error, whatever the egress. */
function assertOneRoute(command: string, options: RouteOptions): void {
	const given = [
		options.egress && '--egress',
		options.proxy && '--proxy',
		options.direct && '--direct',
	].filter(Boolean);
	if (given.length > 1)
		throw new UsageError(
			'CONFLICTING_OPTIONS',
			`webveil ${command}: ${given.join(' and ')} are mutually exclusive ` +
				'(--egress, --proxy <url> and --direct each choose the route); ' +
				'give one of them.',
		);
}

/** A URL with any `user:password@` replaced by `***@`, parsable or not. */
const redactAny = (url: string) => url.replace(/\/\/[^@/]*@/, '//***@');

/** The config's proxied hops, backend hop first. */
function proxiedHops(config: Config) {
	return [
		{name: 'egress', egress: config.egress},
		...(config.fetchEgress
			? [{name: 'fetchEgress', egress: config.fetchEgress}]
			: []),
	].filter((hop) => hop.egress.mode !== 'direct');
}

/**
 * A hop's proxy as searchcast's downloader takes it (credentials kept), or an
 * `EgressError` (credentials redacted) when it cannot be built.
 */
function downloadProxy(name: string, egress: Egress): string {
	let proxy: string | undefined;
	try {
		proxy = searchcastProxy(egress);
	} catch {
		throw new EgressError(
			`${name} ${egress.mode}: invalid proxy url ` +
				`'${redactAny(egress.mode === 'direct' ? '' : (egress.url ?? ''))}'. ` +
				'Nothing was downloaded.',
		);
	}
	if (!proxy || !/^(http|socks5h):\/\//i.test(proxy))
		throw new EgressError(
			`${name} ${egress.mode}: the download cannot go through ` +
				`'${redactAny(proxy ?? '')}' (the downloader takes http://, ` +
				'socks5:// or socks5h:// proxies). Give --proxy <url> or --direct ' +
				'instead. Nothing was downloaded.',
		);
	return proxy;
}

/** A hop's mapped proxy for comparison, or its raw url when unbuildable. */
function mappedOrRaw(egress: Egress): string {
	try {
		return searchcastProxy(egress) ?? '';
	} catch {
		return egress.mode === 'direct' ? '' : (egress.url ?? '');
	}
}

/**
 * The `--egress` route: the proxy of the configured egress hop (undefined:
 * every hop is direct), with the progress line saying which hop it is.
 */
export function egressRoute(
	command: string,
	config: Config,
): {proxy?: string; line: string} {
	const hops = proxiedHops(config);
	const prefix = `webveil ${command} --egress:`;
	if (hops.length === 0)
		return {
			line:
				`${prefix} every configured egress hop is direct, so the download ` +
				"is direct, from this machine's own IP",
		};
	const [hop, other] = hops as [(typeof hops)[0], (typeof hops)[0]?];
	const proxy = downloadProxy(hop.name, hop.egress);
	let line = `${prefix} downloading through ${hop.name} (${redactUrl(proxy)})`;
	if (other && mappedOrRaw(other.egress) !== proxy)
		line +=
			`; ${other.name} (${redactAny(mappedOrRaw(other.egress))}) differs and ` +
			'is not used (give --proxy <url> for it)';
	return {proxy, line};
}

/**
 * The proxy a download goes through (undefined: direct), or a `UsageError`
 * when the route is not explicit although the configured egress is not
 * direct (see the recorded decisions above). `config` is only called when
 * neither `--proxy` nor `--direct` is given; `--egress` reports its route on
 * `log`.
 */
export function downloadRoute(
	command: string,
	options: RouteOptions,
	config: () => Config,
	log: (line: string) => void = () => {},
): string | undefined {
	assertOneRoute(command, options);
	if (options.proxy) return options.proxy;
	if (options.direct) return undefined;
	const resolved = config();
	if (options.egress) {
		const {proxy, line} = egressRoute(command, resolved);
		log(line);
		return proxy;
	}
	const hops = proxiedHops(resolved);
	if (hops.length === 0) return undefined;
	// One `--proxy` line per distinct proxy, naming the hops that use it.
	const proxies = new Map<string, string[]>();
	for (const hop of hops) {
		const proxy = suggestedProxy(hop.egress);
		proxies.set(proxy, [...(proxies.get(proxy) ?? []), hop.name]);
	}
	const redacted = [...proxies.keys()].some((p) => p.includes('//***@'));
	throw new UsageError(
		'ROUTE_REQUIRED',
		`webveil ${command}: the configured egress is not direct ` +
			`(${hops.map((hop) => `${hop.name}: ${describeEgress(hop.egress)}`).join(', ')}), ` +
			"so the download needs an explicit route: without one it would leave from this machine's " +
			'own IP, telling the host that this IP installed it. Nothing was downloaded. Run it again with one of:\n' +
			`  --egress   through the configured ${hops[0]!.name} (its credentials included)\n` +
			[...proxies]
				.map(
					([p, names]) => `  --proxy ${p}   through ${names.join(' and ')}\n`,
				)
				.join('') +
			"  --direct   from this machine's own IP" +
			(redacted ? '\n(put the proxy credentials back in place of ***)' : ''),
	);
}

/**
 * This folder's config, resolved on the first call only (its deprecations
 * reported once), so the route and the IPFS gateways share one resolution.
 */
function lazyConfig(deps: SetupDeps): () => Config {
	let config: Config | undefined;
	return () => {
		if (config) return config;
		config = (deps.resolveConfig ?? realResolveConfig)();
		reportDeprecations(config, deps.log);
		return config;
	};
}

/** The route for `command`, resolving the config only when it is needed. */
function route(
	command: string,
	options: RouteOptions,
	deps: SetupDeps,
	config: () => Config = lazyConfig(deps),
) {
	return downloadRoute(command, options, config, deps.log ?? stderr);
}

/** True when `source` is an `ipfs://<cid>[/<path>]` URL. */
const isIpfs = (source: string) => /^ipfs:\/\//i.test(source);

/** True when `install-recipes` downloads `source` (else: a local file). */
const isDownload = (source: string) =>
	/^https?:\/\//i.test(source) || isIpfs(source);

/**
 * The configured `searchcast.ipfsGateways` (validated), or undefined when no
 * layer sets it (searchcast's `DEFAULT_IPFS_GATEWAYS` then apply). Says on
 * `log` which layer named them, a project file by its path.
 */
export function configuredIpfsGateways(
	config: Config,
	log: (line: string) => void = () => {},
): string[] | undefined {
	const gateways: unknown = config.searchcast?.ipfsGateways;
	if (gateways === undefined) return undefined;
	if (
		!Array.isArray(gateways) ||
		gateways.length === 0 ||
		!gateways.every((g) => typeof g === 'string' && g !== '')
	)
		throw new Error(
			'webveil: searchcast.ipfsGateways must be a non-empty list of gateway ' +
				'base URLs (https://...)',
		);
	const source = sourceOf(config, 'searchcast.ipfsGateways');
	const from = source
		? `${source.layer}${'path' in source ? ` config ${source.path}` : ''}`
		: 'code';
	log(
		`webveil install-recipes: IPFS gateways from searchcast.ipfsGateways ` +
			`(${from}): ${gateways.join(', ')}`,
	);
	return gateways as string[];
}

/** `webveil install-libcurl`: the pinned libcurl-impersonate, checksum verified. */
export async function installLibcurl(
	options: {force?: boolean} & RouteOptions,
	deps: SetupDeps = {},
) {
	const proxy = route('install-libcurl', options, deps);
	const api = await (deps.loadInstall ?? loadInstallApi)();
	return api.installLibcurl({
		...(proxy && {proxy}),
		force: options.force ?? false,
		log: deps.log ?? stderr,
	});
}

/** `webveil install-recipes` options (see cli.ts). */
export interface InstallRecipesFlags extends RouteOptions {
	/** The archive's sha256: required, except for an `ipfs://` source (the CID pins it). */
	sha256?: string;
	name?: string;
	force?: boolean;
	/** `--ipfs-gateway`, repeatable: wins over `searchcast.ipfsGateways`. */
	ipfsGateway?: string[];
}

/**
 * `webveil install-recipes`: a recipe set pinned by its sha256, or by its CID
 * for an `ipfs://` source (see the decisions above).
 */
export async function installRecipes(
	source: string,
	options: InstallRecipesFlags,
	deps: SetupDeps = {},
) {
	const ipfs = isIpfs(source);
	if (!ipfs && options.sha256 === undefined)
		throw new UsageError(
			'SHA256_REQUIRED',
			`webveil install-recipes: --sha256 <hex> is required for ${source}: ` +
				"the archive's sha256 is your trust decision (a set may hold code " +
				'recipes). Only an ipfs:// source may leave it out (the CID pins it). ' +
				'Nothing was downloaded.',
		);
	const config = lazyConfig(deps);
	// A local file makes no request: no route to require (`--direct` and
	// `--egress` are ignored, `--proxy` stays searchcast's own error for a file),
	// but conflicting flags are still refused.
	const proxy = isDownload(source)
		? route('install-recipes', options, deps, config)
		: (assertOneRoute('install-recipes', options), options.proxy);
	// Typed gateways go to searchcast as typed (it refuses them for a non-IPFS
	// source); configured ones only for an ipfs:// source.
	const typed = options.ipfsGateway?.length ? options.ipfsGateway : undefined;
	const ipfsGateways =
		typed ??
		(ipfs ? configuredIpfsGateways(config(), deps.log ?? stderr) : undefined);
	const api = await (deps.loadInstall ?? loadInstallApi)();
	try {
		return await api.installRecipes(source, {
			...(options.sha256 !== undefined && {sha256: options.sha256}),
			...(ipfsGateways && {ipfsGateways}),
			...(options.name && {name: options.name}),
			...(proxy && {proxy}),
			force: options.force ?? false,
			log: deps.log ?? stderr,
		});
	} catch (error) {
		if (!(error instanceof api.InstallError) || !error.suggestions?.length)
			throw error;
		throw new api.InstallError(notASetMessage(source, error, options), {
			cause: error,
			suggestions: error.suggestions,
		});
	}
}

/** A shell word as typed, single-quoted when it holds anything else. */
const shellWord = (word: string) =>
	/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;

/**
 * searchcast's not-a-set refusal, retold with `webveil install-recipes`
 * commands carrying the user's own flags (see the decisions above): its
 * listing (the part before "Try:"), then one command per suggestion.
 */
function notASetMessage(
	source: string,
	error: InstanceType<InstallApi['InstallError']>,
	options: InstallRecipesFlags,
): string {
	const at = error.message.lastIndexOf('. Try: ');
	const listing =
		at >= 0 ? error.message.slice(0, at) : `${source} is not a recipe set`;
	const flags = [
		...(options.egress ? ['--egress'] : []),
		...(options.proxy ? ['--proxy <url>'] : []),
		...(options.direct ? ['--direct'] : []),
		...(options.ipfsGateway ?? []).flatMap((g) => [
			'--ipfs-gateway',
			shellWord(g),
		]),
		...(options.name ? ['--name', shellWord(options.name)] : []),
		...(options.force ? ['--force'] : []),
	];
	const commands = error.suggestions!.map(({source, kind, sha256}) => {
		const words = [
			'webveil install-recipes',
			shellWord(source),
			...(sha256 !== undefined ? ['--sha256', shellWord(sha256)] : []),
			...flags,
		];
		const what =
			kind === 'archive' ? 'a release archive' : 'may be a set directory';
		return `  ${words.join(' ')}   # ${what}`;
	});
	return (
		`webveil install-recipes: ${listing}. Nothing was installed. ` +
		`Try one of:\n${commands.join('\n')}` +
		(options.proxy ? '\n(give your proxy URL in place of <url>)' : '')
	);
}

/** One installed set as `webveil recipes` lists it. */
function describeSet(set: RecipeSet) {
	return {
		name: set.name,
		dir: set.dir,
		...(set.source?.manifest?.version && {
			version: set.source.manifest.version,
		}),
		source: set.source?.source ?? 'unknown (no .source.json)',
		...(set.source?.cid && {cid: set.source.cid}),
		...(set.source?.gateway && {gateway: set.source.gateway}),
		...(set.source?.sha256 && {sha256: set.source.sha256}),
		files: set.files.map((file) => {
			const sha256 = set.source?.files[file];
			return sha256 ? `${file} sha256 ${sha256}` : file;
		}),
	};
}

/**
 * `webveil recipes`: the installed sets, with where they came from; then, when
 * there are any, the sets still in serpcast's old data directory (read for
 * one release), each saying whether it is used or shadowed by a set of the
 * same name in the new one.
 */
export async function listRecipes(deps: SetupDeps = {}) {
	const api = await (deps.loadInstall ?? loadInstallApi)();
	const dir = api.recipesDir();
	const sets = api.listRecipeSets(dir).map(describeSet);
	const oldDir = join(api.oldDataDir(), 'recipes');
	const names = new Set(sets.map((set) => set.name));
	const oldSets = api.listRecipeSets(oldDir).map((set: RecipeSet) => ({
		...describeSet(set),
		used: !names.has(set.name),
	}));
	return {dir, sets, ...(oldSets.length > 0 && {oldDir, oldSets})};
}

/** A proxy URL with its credentials replaced by `***`. */
export function redactUrl(url: string): string {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	if (!parsed.username && !parsed.password) return url;
	return url.replace(/\/\/[^@/]*@/, '//***@');
}

const describeEgress = (egress: Egress) =>
	egress.mode === 'direct'
		? 'direct'
		: `${egress.mode} ${redactUrl(egress.url ?? '')}`;

/** The configured `set:` entries of `recipes` and `codeRecipes`, name only. */
function setEntries(config: Config): string[] {
	const entries = [
		...(config.searchcast?.recipes ?? []),
		...(config.searchcast?.codeRecipes ?? []),
	];
	return [
		...new Set(
			entries.filter((e) => typeof e === 'string' && e.startsWith('set:')),
		),
	];
}

/** What `webveil doctor` reports. */
export interface DoctorResult {
	healthy: boolean;
	problems: string[];
	backend: string;
	egress: string;
	fetchEgress: string;
	fetchTransport?: string;
	libcurl?: Omit<DoctorReport, 'oldDataDir'> & {needed: boolean};
	/**
	 * What is still read from serpcast's old data directory (the library, recipe
	 * sets), with the command that moves it; absent when nothing is.
	 */
	oldDataDir?: OldDataDirHits;
	/**
	 * The deprecated `serpcast` spellings this folder's config uses, each
	 * naming its new spelling; absent when there are none. Not a problem.
	 */
	deprecations?: string[];
	/**
	 * Present while `backend` is the built-in default (no layer sets it): says
	 * the default changed and how to restore SearXNG. Not a problem.
	 */
	defaultBackend?: string;
	/**
	 * Present while the searchcast backend runs the bundled default chain (no
	 * engines, recipes or code recipes set): says so and points to recipes.
	 * Not a problem.
	 */
	defaultChain?: string;
	engines?: EngineDescription[];
	/** Each configured `set:` entry; `source` is where it was installed from (`.source.json`). */
	sets?: {entry: string; installed: boolean; dir: string; source?: string}[];
}

/** Run `fn`, recording its error message in `problems` instead of throwing. */
async function attempt<T>(
	problems: string[],
	fn: () => T | Promise<T>,
): Promise<T | undefined> {
	try {
		return await fn();
	} catch (error) {
		problems.push((error as Error).message);
		return undefined;
	}
}

/** `webveil doctor`: searchcast's report plus webveil's view of this folder. */
export async function doctor(
	options: {remote?: boolean} & ResolveOptions,
	deps: SetupDeps = {},
): Promise<DoctorResult> {
	const api = await (deps.loadInstall ?? loadInstallApi)();
	const config = (deps.resolveConfig ?? realResolveConfig)(options);
	const problems: string[] = [];
	const fetchConfig = fetchEgressConfig(config);
	const transport = await attempt(problems, () =>
		resolveFetchTransport(config),
	);
	const result: DoctorResult = {
		healthy: false,
		problems,
		backend: config.backend,
		egress: describeEgress(config.egress),
		fetchEgress: describeEgress(fetchConfig.egress),
		...(transport && {fetchTransport: transport}),
	};
	const deprecations = configDeprecations(config);
	if (deprecations.length > 0) result.deprecations = deprecations;
	if (usesDefaultBackend(config)) result.defaultBackend = DEFAULT_BACKEND_NOTE;
	if (usesDefaultSearchcastChain(config))
		result.defaultChain = DEFAULT_CHAIN_NOTE;
	const searchcastBackend = config.backend === 'searchcast';
	const needed = searchcastBackend || transport === 'searchcast';
	const libcurlPath = await attempt(problems, () => ({
		path: trustedLibcurlPath(config),
	}));
	const proxy = await attempt(problems, () =>
		searchcastProxy(searchcastBackend ? config.egress : fetchConfig.egress),
	);
	if (libcurlPath) {
		const {oldDataDir: _old, ...report} = await api.doctor({
			...(libcurlPath.path && {libcurlPath: libcurlPath.path}),
			...(proxy && {proxy}),
			remote: options.remote ?? false,
		});
		result.libcurl = {needed, ...report};
		if (needed && !api.healthy(report))
			problems.push(
				report.problem
					? `${report.problem} (with webveil: reinstall it with optional ` +
							'dependencies, which bring @searchcast/libcurl-<platform> on ' +
							'supported platforms; else `webveil install-libcurl`, or ' +
							'searchcast.libcurlPath in the global config)'
					: `remote check failed: ${report.remote?.error ?? 'unknown'}`,
			);
	}
	const old = api.oldDataDirHits();
	if (old) result.oldDataDir = old;
	if (searchcastBackend) {
		const dir = api.recipesDir();
		result.sets = setEntries(config).map((entry) => {
			const name = entry.slice('set:'.length).split('/')[0]!;
			const found = api.recipeSetDir(name);
			if (!found) {
				problems.push(
					`recipe set '${name}' (${entry}) is not installed in ${dir}: ` +
						'webveil install-recipes <archive> --sha256 <hex> (or ' +
						'ipfs://<cid>)',
				);
				return {entry, installed: false, dir: join(dir, name)};
			}
			const set = api
				.listRecipeSets(dirname(found))
				.find((s: RecipeSet) => s.name === name);
			return {
				entry,
				installed: true,
				dir: found,
				...(set?.source && {source: set.source.source}),
			};
		});
		// A missing set is already reported; resolving the chain would only
		// report it again.
		if (result.sets.every((set) => set.installed))
			result.engines = await attempt(problems, () =>
				describeSearchcastEngines(config),
			);
	}
	result.healthy = problems.length === 0;
	return result;
}
