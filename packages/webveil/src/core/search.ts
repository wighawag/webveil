// core search — the plain, framework-agnostic `search()` BOTH frontends (the
// incur CLI/MCP and the pi extension) call. It owns the wiring and the
// caller-facing post-processing; the per-source parsing lives in the backend.
//
// Flow: resolve config → build the egress dispatcher → bind the proxied `http`
// helper to it → select the backend from the registry → call the backend with
// ONLY that proxied helper → normalize (dedup + clamp) the SearchResult[].
//
// The egress invariant (docs/adr/0001): the backend is handed only the
// dispatcher-bound `http` helper, so it physically cannot reach a global fetch
// and bypass the configured egress. A configured-but-unbuildable proxy throws at
// buildDispatcher (fail-loud), never silently un-proxied.

import {resolveConfig as defaultResolveConfig} from './config.js';
import type {Config, ResolveOptions} from './config.js';
import {
	buildDispatcher as defaultBuildDispatcher,
	assertEgressAllowsBaseUrl as defaultAssertEgressAllowsBaseUrl,
} from './egress.js';
import type {Dispatcher} from './egress.js';
import {resolveBackendTransport as defaultResolveBackendTransport} from './baseurl.js';
import type {BackendTransport} from './baseurl.js';
import {createHttp as defaultCreateHttp} from './http.js';
import {getBackend as defaultGetBackend} from './backends/registry.js';
import type {Http, SearchOptions, SearchResult} from './backends/types.js';

/**
 * Default cap on returned results when the caller does not pass `maxResults`.
 * Keeps an agent's context small by default; a caller can raise/lower it per
 * call. (Recorded decision: there is no configured default, so the core sets
 * one; see the task's Decisions block.)
 */
const DEFAULT_MAX_RESULTS = 10;

/**
 * Collaborators, seamed so the core is testable WITHOUT real config files,
 * undici, or network: a test injects a fake `getBackend`/`createHttp` to assert
 * the backend is handed only the proxied helper, and a fake backend returning
 * duplicate/over-limit hits to assert dedup + clamp. Defaults wire the real
 * config/egress/http/registry modules.
 */
export interface SearchDeps {
	resolveConfig?: (options?: ResolveOptions) => Config;
	buildDispatcher?: (config: Config) => Dispatcher | undefined;
	assertEgressAllowsBaseUrl?: (config: Config) => void;
	resolveBackendTransport?: (baseUrl: string) => BackendTransport;
	createHttp?: (dispatcher: Dispatcher | undefined) => Http;
	getBackend?: (
		name: string,
		config: Config,
	) => {
		search: (
			query: string,
			http: Http,
			options?: SearchOptions,
		) => Promise<SearchResult[]>;
	};
}

/** Per-call search options plus the config-resolution knobs (cwd/env/global). */
export interface SearchCoreOptions extends SearchOptions, ResolveOptions {}

/** Dedup by url (the hit's identity), preserving first-seen order. */
function dedup(results: SearchResult[]): SearchResult[] {
	const seen = new Set<string>();
	const out: SearchResult[] = [];
	for (const r of results) {
		if (seen.has(r.url)) continue;
		seen.add(r.url);
		out.push(r);
	}
	return out;
}

/**
 * Search the configured backend over the configured egress and return
 * normalized `SearchResult[]` (deduped by url, then clamped to `maxResults`).
 *
 * Dedup runs BEFORE the clamp so the caller gets up to `maxResults` UNIQUE hits,
 * not a window that duplicates eat into; for the same reason the backend is NOT
 * asked to pre-clamp (only the abort signal is forwarded).
 */
export async function search(
	query: string,
	options: SearchCoreOptions = {},
	deps: SearchDeps = {},
): Promise<SearchResult[]> {
	const resolveConfig = deps.resolveConfig ?? defaultResolveConfig;
	const buildDispatcher = deps.buildDispatcher ?? defaultBuildDispatcher;
	const assertEgressAllowsBaseUrl =
		deps.assertEgressAllowsBaseUrl ?? defaultAssertEgressAllowsBaseUrl;
	const resolveBackendTransport =
		deps.resolveBackendTransport ?? defaultResolveBackendTransport;
	const createHttp = deps.createHttp ?? defaultCreateHttp;
	const getBackend = deps.getBackend ?? defaultGetBackend;

	const config = resolveConfig({
		cwd: options.cwd,
		env: options.env,
		globalPath: options.globalPath,
	});

	// Fail loud on the false-confidence combo (a local `unix:` socket baseUrl
	// behind a proxy egress) BEFORE any transport is built.
	assertEgressAllowsBaseUrl(config);

	// Resolve the BACKEND-hop transport. For a normal TCP baseUrl this is a no-op
	// (no per-hop dispatcher); for a `unix:` baseUrl it yields a socket-bound
	// `Agent` and a synthetic `http://localhost…` base the backend builds on. The
	// socket transport is scoped to THIS hop only and is NEVER bound into the
	// shared config-wide egress dispatcher, so `web_fetch` egress is unaffected.
	const transport = resolveBackendTransport(config.baseUrl);

	// Build the egress dispatcher FIRST: a configured-but-unbuildable proxy throws
	// here, before any network access (never an un-proxied request). For a socket
	// baseUrl the per-hop socket dispatcher overrides the (direct/undefined) one.
	const dispatcher = transport.dispatcher ?? buildDispatcher(config);
	const http = createHttp(dispatcher);

	// The backend stays transport-unaware: it receives a config whose baseUrl is
	// always a real `http(s):` base (the `unix:` form is rewritten away here).
	const backendConfig: Config =
		transport.baseUrl === config.baseUrl
			? config
			: {...config, baseUrl: transport.baseUrl};
	const backend = getBackend(backendConfig.backend, backendConfig);
	// Hand the backend ONLY the proxied helper (no maxResults: dedup happens
	// here, over the full set, so the clamp below is over UNIQUE results).
	let raw: SearchResult[];
	try {
		raw = await backend.search(query, http, {signal: options.signal});
	} finally {
		// Best-effort close of the per-hop socket Agent (the shared egress
		// dispatcher, owned by config, is NOT touched here).
		if (transport.dispatcher) void transport.dispatcher.close();
	}

	const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
	return dedup(raw).slice(0, maxResults);
}
