// core fetch: the plain, framework-agnostic `fetch()` BOTH frontends (the incur
// CLI/MCP and the pi extension) call. Returns clean, size-bounded markdown with
// distilly's `truncated` flag.
//
// Flow (per URL): pick the content source (a backend's own `/extract`
// (tavily-compat) when the configured backend provides one, OTHERWISE the
// default distilly Extractor seam, urlToMarkdown over webveil's egress). The
// SSRF guard lives INSIDE the egress-bound fetch injected into distilly, so it
// covers distilly's rule-rewritten requests too (docs/adr/0001).
//
// LIST-READY INTERNALS (story 12): the work happens in `fetchAll(urls, …)`, a
// list-processing internal, so a future `web_batch_fetch` tool is a trivial add
// with no redesign. The public `fetch()` is a thin single-URL wrapper over it.

import {resolveConfig as defaultResolveConfig} from './config.js';
import type {Config, ResolveOptions} from './config.js';
import {createEgressFetch as defaultCreateEgressFetch} from './egress.js';
import type {EgressFetch} from './egress.js';
import {guardEgressFetch as defaultGuardEgressFetch} from './security.js';
import {createHttp as defaultCreateHttp} from './http.js';
import {buildDispatcher as defaultBuildDispatcher} from './egress.js';
import type {Dispatcher} from './egress.js';
import {extract as defaultExtract} from './extract.js';
import type {ExtractDeps} from './extract.js';
import {getBackend as defaultGetBackend} from './backends/registry.js';
import type {
	Backend,
	FetchOptions,
	FetchResult,
	Http,
} from './backends/types.js';

/**
 * Collaborators, seamed so the core is testable WITHOUT real config files,
 * undici, network, or distilly: a test injects fakes to assert the
 * backend-`/extract`-vs-distilly branch, the list path, and that the guarded
 * egress fetch (never a global) is what reaches distilly. Defaults wire the real
 * modules.
 */
export interface FetchDeps {
	resolveConfig?: (options?: ResolveOptions) => Config;
	getBackend?: (name: string, config: Config) => Backend;
	buildDispatcher?: (config: Config) => Dispatcher | undefined;
	createHttp?: (dispatcher: Dispatcher | undefined) => Http;
	createEgressFetch?: (config: Config) => EgressFetch;
	guardEgressFetch?: (fetch: EgressFetch, config: Config) => EgressFetch;
	extract?: (
		url: string,
		config: Config,
		options: {size?: Config['fetchSize']},
		deps: ExtractDeps,
	) => Promise<FetchResult>;
}

/** Per-call fetch options plus the config-resolution knobs (cwd/env/global). */
export interface FetchCoreOptions extends FetchOptions, ResolveOptions {}

/**
 * Fetch a LIST of urls to clean, size-bounded markdown, in order. This is the
 * list-ready internal (story 12): the single-URL `fetch()` below is a thin
 * wrapper over it, so a future `web_batch_fetch` reuses this directly.
 *
 * Each url goes through the SAME content-source choice: a backend's own
 * `/extract` (if the configured backend implements `fetch`) OR the default
 * distilly Extractor with the GUARDED egress fetch injected.
 */
export async function fetchAll(
	urls: string[],
	options: FetchCoreOptions = {},
	deps: FetchDeps = {},
): Promise<FetchResult[]> {
	const resolveConfig = deps.resolveConfig ?? defaultResolveConfig;
	const getBackend = deps.getBackend ?? defaultGetBackend;
	const buildDispatcher = deps.buildDispatcher ?? defaultBuildDispatcher;
	const createHttp = deps.createHttp ?? defaultCreateHttp;
	const createEgressFetch = deps.createEgressFetch ?? defaultCreateEgressFetch;
	const guardEgressFetch = deps.guardEgressFetch ?? defaultGuardEgressFetch;
	const extract = deps.extract ?? defaultExtract;

	const config = resolveConfig({
		cwd: options.cwd,
		env: options.env,
		globalPath: options.globalPath,
	});

	const backend = getBackend(config.backend, config);

	// A backend that provides its own `/extract` (tavily-compat) OVERRIDES the
	// distilly Extractor; it is handed only the proxied http helper (built from
	// the SAME dispatcher as the egress fetch), so it cannot bypass egress.
	if (backend.fetch) {
		const http = createHttp(buildDispatcher(config));
		const backendFetch = backend.fetch.bind(backend);
		return runAll(urls, (url) =>
			backendFetch(url, http, {size: options.size, signal: options.signal}),
		);
	}

	// Default path: distilly Extractor over webveil's egress. Build the
	// egress-bound fetch ONCE, wrap it with the SSRF guard, and inject THAT into
	// distilly (never a global fetch). The guard covers distilly's rule-rewritten
	// requests too. A configured-but-unbuildable proxy throws at build time
	// (fail-loud), before any I/O.
	const guardedFetch = guardEgressFetch(createEgressFetch(config), config);
	const extractDeps: ExtractDeps = {createEgressFetch: () => guardedFetch};
	return runAll(urls, (url) =>
		extract(url, config, {size: options.size}, extractDeps),
	);
}

/** Run a per-url worker over the list in order, collecting the results. */
async function runAll(
	urls: string[],
	work: (url: string) => Promise<FetchResult>,
): Promise<FetchResult[]> {
	const out: FetchResult[] = [];
	for (const url of urls) out.push(await work(url));
	return out;
}

/**
 * Fetch ONE url to clean, size-bounded markdown (`{ markdown, truncated, … }`).
 * A thin single-URL wrapper over the list-ready `fetchAll` (story 12).
 */
export async function fetch(
	url: string,
	options: FetchCoreOptions = {},
	deps: FetchDeps = {},
): Promise<FetchResult> {
	const [result] = await fetchAll([url], options, deps);
	return result!;
}
