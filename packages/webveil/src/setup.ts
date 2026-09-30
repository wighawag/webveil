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
//   it to serpcast (`serpcastProxy`: SOCKS as `socks5h://`), egress first,
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
//   ignored; `--proxy` stays serpcast's own error for a file).
// - Exit code 2 with error codes `ROUTE_REQUIRED` and `CONFLICTING_OPTIONS`,
//   the convention for a usage error; the other failures keep exit 1.
//   `doctor --remote` is unchanged: it already goes through the egress.
//
// Recorded decisions (task install-egress-flag, owner request 2026-09-30):
// `--egress` is a third explicit route: download through the egress webveil
// already has configured, resolved as `search` resolves it (cwd, project,
// global, env) and mapped as for serpcast (`serpcastProxy`: SOCKS as
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
// - Not buildable (`downloadProxy`): an egress URL `serpcastProxy` rejects, or
//   an `https://` http proxy (serpcast accepts it for search, but its
//   downloader takes only http://, socks5:// and socks5h://), fails loud
//   before any request with an `EgressError` (exit 1, like a `search` whose
//   egress cannot be built), never a silent fallback to direct.
// - `--egress` with `--proxy` or `--direct` is `CONFLICTING_OPTIONS` (exit 2).
//   A local file for `install-recipes`: `--egress` is accepted and ignored,
//   like `--direct`, and the config is not resolved.
//
// - No `--dir` for `install-recipes`: webveil resolves `set:<name>` in
//   serpcast's recipes directory only (backends/serpcast.ts), so a set
//   installed elsewhere could not be named. The plain serpcast CLI still has
//   it for other uses.
// - `recipes` is a single command listing the installed sets (the task's
//   spelling), not serpcast's `recipes list` group.
// - `doctor`: serpcast's report for the library webveil would load (its
//   trusted `serpcast.libcurlPath`, else serpcast's own lookup), plus
//   webveil's view of the current folder's config: backend, both egress hops
//   (credentials redacted), the fetch transport, the engine chain resolved to
//   recipe files, and each configured `set:` entry. It is healthy when
//   impersonation is active (only required when the backend or the fetch
//   transport is serpcast, the only users of the library) and nothing in
//   webveil's view failed. `--remote` asks serpcast's echo service once,
//   through the serpcast backend's `egress` when that is the backend, else
//   through the fetch hop's egress (the hop that uses the library then).
// - Progress lines go to stderr as serpcast's CLI prints them; the result is
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
//   then old), as a search resolves it (backends/serpcast.ts).

import {join} from 'node:path';
import type {DoctorReport, OldDataDirHits, RecipeSet} from 'searchcast/install';
import {resolveConfig as realResolveConfig} from './core/config.js';
import type {Config, Egress, ResolveOptions} from './core/config.js';
import {EgressError, fetchEgressConfig} from './core/egress.js';
import {resolveFetchTransport} from './core/fetch-transport.js';
import {
	describeSerpcastEngines,
	serpcastProxy,
	trustedLibcurlPath,
} from './core/backends/serpcast.js';
import type {EngineDescription} from './core/backends/serpcast.js';

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
		readonly code: 'ROUTE_REQUIRED' | 'CONFLICTING_OPTIONS',
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
		proxy = serpcastProxy(egress) ?? '';
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
 * A hop's proxy as serpcast's downloader takes it (credentials kept), or an
 * `EgressError` (credentials redacted) when it cannot be built.
 */
function downloadProxy(name: string, egress: Egress): string {
	let proxy: string | undefined;
	try {
		proxy = serpcastProxy(egress);
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
		return serpcastProxy(egress) ?? '';
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

/** The route for `command`, resolving the config only when it is needed. */
function route(command: string, options: RouteOptions, deps: SetupDeps) {
	return downloadRoute(
		command,
		options,
		() => (deps.resolveConfig ?? realResolveConfig)(),
		deps.log ?? stderr,
	);
}

/** True when `install-recipes` downloads `source` (else: a local file). */
const isDownload = (source: string) => /^https?:\/\//i.test(source);

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

/** `webveil install-recipes`: a checksum-pinned recipe set. */
export async function installRecipes(
	source: string,
	options: {sha256: string; name?: string; force?: boolean} & RouteOptions,
	deps: SetupDeps = {},
) {
	// A local file makes no request: no route to require (`--direct` and
	// `--egress` are ignored, `--proxy` stays serpcast's own error for a file),
	// but conflicting flags are still refused.
	const proxy = isDownload(source)
		? route('install-recipes', options, deps)
		: (assertOneRoute('install-recipes', options), options.proxy);
	const api = await (deps.loadInstall ?? loadInstallApi)();
	return api.installRecipes(source, {
		sha256: options.sha256,
		...(options.name && {name: options.name}),
		...(proxy && {proxy}),
		force: options.force ?? false,
		log: deps.log ?? stderr,
	});
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
		...(set.source && {sha256: set.source.sha256}),
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
		...(config.serpcast?.recipes ?? []),
		...(config.serpcast?.codeRecipes ?? []),
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
	engines?: EngineDescription[];
	sets?: {entry: string; installed: boolean; dir: string}[];
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

/** `webveil doctor`: serpcast's report plus webveil's view of this folder. */
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
	const serpcastBackend = config.backend === 'serpcast';
	const needed = serpcastBackend || transport === 'serpcast';
	const libcurlPath = await attempt(problems, () => ({
		path: trustedLibcurlPath(config),
	}));
	const proxy = await attempt(problems, () =>
		serpcastProxy(serpcastBackend ? config.egress : fetchConfig.egress),
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
							'serpcast.libcurlPath in the global config)'
					: `remote check failed: ${report.remote?.error ?? 'unknown'}`,
			);
	}
	const old = api.oldDataDirHits();
	if (old) result.oldDataDir = old;
	if (serpcastBackend) {
		const dir = api.recipesDir();
		result.sets = setEntries(config).map((entry) => {
			const name = entry.slice('set:'.length).split('/')[0]!;
			const found = api.recipeSetDir(name);
			if (!found)
				problems.push(
					`recipe set '${name}' (${entry}) is not installed in ${dir}: ` +
						'webveil install-recipes <archive> --sha256 <hex>',
				);
			return {entry, installed: !!found, dir: found ?? join(dir, name)};
		});
		// A missing set is already reported; resolving the chain would only
		// report it again.
		if (result.sets.every((set) => set.installed))
			result.engines = await attempt(problems, () =>
				describeSerpcastEngines(config),
			);
	}
	result.healthy = problems.length === 0;
	return result;
}
