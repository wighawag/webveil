// setup: the four commands that make webveil the only thing a user installs
// (`install-libcurl`, `install-recipes`, `recipes`, `doctor`), wrapping
// serpcast's install API. The installers live on serpcast's separate
// `serpcast/install` entry, which this module imports LAZILY (`loadInstallApi`),
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

import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {DoctorReport, RecipeSet} from 'serpcast/install';
import {resolveConfig as realResolveConfig} from './core/config.js';
import type {Config, Egress, ResolveOptions} from './core/config.js';
import {fetchEgressConfig} from './core/egress.js';
import {resolveFetchTransport} from './core/fetch-transport.js';
import {
	describeSerpcastEngines,
	serpcastProxy,
	trustedLibcurlPath,
} from './core/backends/serpcast.js';
import type {EngineDescription} from './core/backends/serpcast.js';

/** serpcast's install API (the `serpcast/install` entry). */
export type InstallApi = typeof import('serpcast/install');

/** Import `serpcast/install`: the only place download code is loaded. */
export function loadInstallApi(): Promise<InstallApi> {
	return import('serpcast/install');
}

/** Seams: the install API, the progress sink, and config resolution. */
export interface SetupDeps {
	loadInstall?: () => Promise<InstallApi>;
	log?: (line: string) => void;
	resolveConfig?: (options?: ResolveOptions) => Config;
}

const stderr = (line: string) => void process.stderr.write(`${line}\n`);

/** `webveil install-libcurl`: the pinned libcurl-impersonate, checksum verified. */
export async function installLibcurl(
	options: {proxy?: string; force?: boolean},
	deps: SetupDeps = {},
) {
	const api = await (deps.loadInstall ?? loadInstallApi)();
	return api.installLibcurl({
		...(options.proxy && {proxy: options.proxy}),
		force: options.force ?? false,
		log: deps.log ?? stderr,
	});
}

/** `webveil install-recipes`: a checksum-pinned recipe set. */
export async function installRecipes(
	source: string,
	options: {sha256: string; name?: string; proxy?: string; force?: boolean},
	deps: SetupDeps = {},
) {
	const api = await (deps.loadInstall ?? loadInstallApi)();
	return api.installRecipes(source, {
		sha256: options.sha256,
		...(options.name && {name: options.name}),
		...(options.proxy && {proxy: options.proxy}),
		force: options.force ?? false,
		log: deps.log ?? stderr,
	});
}

/** `webveil recipes`: the installed sets, with where they came from. */
export async function listRecipes(deps: SetupDeps = {}) {
	const api = await (deps.loadInstall ?? loadInstallApi)();
	const dir = api.recipesDir();
	const sets = api.listRecipeSets(dir).map((set: RecipeSet) => ({
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
	}));
	return {dir, sets};
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
	libcurl?: DoctorReport & {needed: boolean};
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
		const report = await api.doctor({
			...(libcurlPath.path && {libcurlPath: libcurlPath.path}),
			...(proxy && {proxy}),
			remote: options.remote ?? false,
		});
		result.libcurl = {needed, ...report};
		if (needed && !api.healthy(report))
			problems.push(
				report.problem
					? `${report.problem} (with webveil: \`webveil install-libcurl\`, ` +
							'or serpcast.libcurlPath in the global config)'
					: `remote check failed: ${report.remote?.error ?? 'unknown'}`,
			);
	}
	if (serpcastBackend) {
		const dir = api.recipesDir();
		result.sets = setEntries(config).map((entry) => {
			const name = entry.slice('set:'.length).split('/')[0]!;
			const installed = existsSync(join(dir, name));
			if (!installed)
				problems.push(
					`recipe set '${name}' (${entry}) is not installed in ${dir}: ` +
						'webveil install-recipes <archive> --sha256 <hex>',
				);
			return {entry, installed, dir: join(dir, name)};
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
