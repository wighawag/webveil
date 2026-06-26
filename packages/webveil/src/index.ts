// webveil — anonymous-capable, self-hosted, account-free web search + fetch for agents.
//
// This is the public surface. The framework-agnostic core lives under src/core:
//   - core/config.ts            : config seam (per-folder .pi/webveil.json + global + env)
//   - core/egress.ts            : egress seam (direct | http | socks5/Tor) — dispatcher + egress fetch
//   - core/http.ts              : the proxied `http` helper handed to backends
//   - core/extract.ts           : Extractor seam (distilly/fetch + injected egress fetch)
//   - core/backends/types.ts    : backend seam (the Backend interface + result shapes)
//   - core/backends/registry.ts : name -> Backend dispatcher
//   - core/backends/searxng.ts  : the keyless self-hosted SearXNG backend
//   - core/search.ts            : the framework-agnostic search() both frontends call
// Still-placeholder (built by later tasks): core/fetch.ts,
//   core/backends/{tavily-compat,custom}.ts, cli.ts.
// pi-webveil (sibling package) wraps the SAME core functions as registerTool
// web_search / web_fetch, in-process, as an Ollama drop-in.

// config seam
export {resolveConfig} from './core/config.js';
export type {
	Config,
	Egress,
	FetchSize,
	PartialConfig,
	ResolveOptions,
} from './core/config.js';

// egress seam
export {
	buildDispatcher,
	createEgressFetch,
	EgressError,
} from './core/egress.js';
export type {Dispatcher, EgressFetch} from './core/egress.js';

// http helper
export {createHttp} from './core/http.js';

// Extractor seam (distilly/fetch over webveil's egress)
export {extract} from './core/extract.js';
export type {ExtractOptions, ExtractDeps} from './core/extract.js';

// backend seam (the contract + result types)
export type {
	Backend,
	Http,
	HttpRequestOptions,
	SearchResult,
	FetchResult,
	SearchOptions,
	FetchOptions,
} from './core/backends/types.js';

// backend registry + implementations
export {backendNames, getBackend} from './core/backends/registry.js';
export type {BackendFactory} from './core/backends/registry.js';
export {createSearxngBackend} from './core/backends/searxng.js';

// core search (the framework-agnostic search() both frontends call)
export {search} from './core/search.js';
export type {SearchCoreOptions, SearchDeps} from './core/search.js';

import type {FetchResult, FetchOptions} from './core/backends/types.js';

export async function fetch(
	_url: string,
	_options: FetchOptions = {},
): Promise<FetchResult> {
	throw new Error('webveil: fetch not implemented yet (see work/prds/ready)');
}
