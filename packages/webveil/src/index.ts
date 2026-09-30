// webveil — anonymous-capable, self-hosted, account-free web search + fetch for agents.
//
// This is the public surface. The framework-agnostic core lives under src/core:
//   - core/config.ts            : config seam (per-folder webveil.json + global + env)
//   - core/layers.ts            : key-by-key layer merge + per-key provenance
//   - core/trust.ts             : executable settings refused from a project webveil.json
//   - core/egress.ts            : egress seam (direct | http | socks5/Tor) — dispatcher + egress fetch
//   - core/http.ts              : the proxied `http` helper handed to backends
//   - core/extract.ts           : Extractor seam (distilly/fetch + injected egress fetch)
//   - core/backends/types.ts    : backend seam (the Backend interface + result shapes)
//   - core/backends/registry.ts : name -> Backend dispatcher
//   - core/backends/searxng.ts  : the keyless self-hosted SearXNG backend
//   - core/backends/tavily-compat.ts : the generic Tavily-shaped backend (/search + /extract)
//   - core/search.ts            : the framework-agnostic search() both frontends call
//   - core/security.ts          : SSRF guard wrapped around the egress fetch
//   - core/fetch.ts             : the framework-agnostic fetch() both frontends call
//   - core/fetch-transport.ts   : web_fetch's transport (plain undici | serpcast impersonated)
//   - core/backends/custom.ts  : the local-command escape hatch (JSON stdin/stdout)
//   - core/backends/serpcast.ts : keyless recipes over libcurl-impersonate (egress = search egress)
//   - core/state.ts             : serpcast's state store on disk, one partition per identity
//   - core/tunables.ts          : every tuning value's rule and default (validated where used)
//   - cli.ts                    : the incur CLI + MCP frontend (the `webveil` bin)
//   - setup.ts                  : the CLI-only setup commands (install-libcurl, install-recipes,
//                                 recipes, doctor); loads `serpcast/install` lazily
// pi-webveil (sibling package) wraps the SAME core functions as registerTool
// web_search / web_fetch, in-process, as an Ollama drop-in.

// config seam
export {resolveConfig} from './core/config.js';
export {configProvenance} from './core/layers.js';
export type {ConfigSource, Provenance} from './core/layers.js';

// trust (executable settings only from env or the global config; ADR 0004)
export {
	assertTrusted,
	resolveExecutablePath,
	sourceOf,
	TrustError,
} from './core/trust.js';
export type {
	Config,
	Egress,
	FetchSize,
	FetchTransport,
	PartialConfig,
	FetchSerpcastConfig,
	ResolveOptions,
	SearchcastConfig,
	SerpcastConfig,
	StateConfig,
} from './core/config.js';

// egress seam
export {
	assertEgressAllowsBaseUrl,
	buildDispatcher,
	createEgressFetch,
	EgressError,
	fetchEgressConfig,
} from './core/egress.js';
export type {Dispatcher, EgressFetch} from './core/egress.js';

// http helper
export {createHttp} from './core/http.js';

// Extractor seam (distilly/fetch over webveil's egress)
export {extract} from './core/extract.js';
export type {ExtractOptions, ExtractDeps} from './core/extract.js';

// SSRF guard (wrapped around the egress fetch; covers distilly's requests too)
export {
	assertPublicUrl,
	guardEgressFetch,
	isLoopbackHost,
	isPrivateIp,
	SsrfError,
} from './core/security.js';

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
export {
	backendNames,
	closeBackends,
	getBackend,
} from './core/backends/registry.js';
export type {BackendFactory} from './core/backends/registry.js';
export {createSearxngBackend} from './core/backends/searxng.js';
export {createTavilyCompatBackend} from './core/backends/tavily-compat.js';
export {createCustomBackend} from './core/backends/custom.js';
export type {SpawnFn} from './core/backends/custom.js';
export {
	clearSerpcastState,
	createSerpcastBackend,
	serpcastIdentityKey,
	serpcastProxy,
} from './core/backends/serpcast.js';
export type {SerpcastDeps} from './core/backends/serpcast.js';

// per-identity state (serpcast sessions and cooldowns on disk; ADR 0004)
export {
	clearState,
	createStateStore,
	partitionDir,
	stateRoot,
} from './core/state.js';
export type {StateStoreOptions} from './core/state.js';

// core search (the framework-agnostic search() both frontends call)
export {search} from './core/search.js';
export type {SearchCoreOptions, SearchDeps} from './core/search.js';

// web_fetch transport (plain undici, or serpcast's impersonated transport)
export {
	closeFetchTransports,
	createSerpcastFetch,
	resolveFetchTransport,
} from './core/fetch-transport.js';
export type {SerpcastFetchDeps} from './core/fetch-transport.js';

// core fetch (the framework-agnostic fetch() + list-ready fetchAll internal)
export {fetch, fetchAll} from './core/fetch.js';
export type {FetchCoreOptions, FetchDeps} from './core/fetch.js';

// incur CLI + MCP frontend (the `webveil` bin builds and serves this)
export {createCli, serveCli} from './cli.js';
export type {CliDeps, CliOptions} from './cli.js';
export type {DoctorResult, SetupDeps} from './setup.js';
