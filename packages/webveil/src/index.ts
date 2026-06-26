// webveil — anonymous-capable, self-hosted, account-free web search + fetch for agents.
//
// This is the public surface. The framework-agnostic core lives under src/core:
//   - core/config.ts            : config seam (per-folder .pi/webveil.json + global + env)
//   - core/egress.ts            : egress seam (direct | http | socks5/Tor) — dispatcher + egress fetch
//   - core/http.ts              : the proxied `http` helper handed to backends
//   - core/backends/types.ts    : backend seam (the Backend interface + result shapes)
//   - core/backends/registry.ts : name -> Backend dispatcher
//   - core/backends/searxng.ts  : the keyless self-hosted SearXNG backend
// Still-placeholder (built by later tasks): core/search.ts, core/fetch.ts,
//   core/backends/{tavily-compat,custom}.ts, core/extract.ts, cli.ts.
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

import type {
	SearchResult,
	FetchResult,
	SearchOptions,
	FetchOptions,
} from './core/backends/types.js';

export async function search(
	_query: string,
	_options: SearchOptions = {},
): Promise<SearchResult[]> {
	throw new Error('webveil: search not implemented yet (see work/prds/ready)');
}

export async function fetch(
	_url: string,
	_options: FetchOptions = {},
): Promise<FetchResult> {
	throw new Error('webveil: fetch not implemented yet (see work/prds/ready)');
}
