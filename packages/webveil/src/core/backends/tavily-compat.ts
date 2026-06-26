// tavily-compat backend — a generic Tavily-shaped client (POST `/search` and an
// optional POST `/extract`) selected purely by `baseUrl`, so it covers
// orio-search / searcharvester / agent-search and any other Tavily-API-shaped
// instance. Both endpoints go THROUGH the handed `http` helper (never a direct
// fetch, so egress is not bypassable). `/search` normalizes to SearchResult[];
// `/extract` is exposed as the optional `Backend.fetch` a later task uses to
// override the distilly Extractor.
//
// Auth: a Bearer header is sent only when an apiKey is configured. The covered
// self-hosted instances are typically keyless, so a missing key is normal, not
// an error.

import type {Config} from '../config.js';
import type {
	Backend,
	FetchOptions,
	FetchResult,
	Http,
	HttpRequestOptions,
	SearchOptions,
	SearchResult,
} from './types.js';

/** One entry in a Tavily `/search` `results` array (subset we use). */
interface TavilySearchHit {
	title?: unknown;
	url?: unknown;
	content?: unknown;
}

/** The Tavily `/search` response (subset we use). */
interface TavilySearchResponse {
	results?: TavilySearchHit[];
}

/** One entry in a Tavily `/extract` `results` array (subset we use). */
interface TavilyExtractHit {
	url?: unknown;
	raw_content?: unknown;
}

/** One entry in a Tavily `/extract` `failed_results` array (subset we use). */
interface TavilyExtractFailure {
	url?: unknown;
	error?: unknown;
}

/** The Tavily `/extract` response (subset we use). */
interface TavilyExtractResponse {
	results?: TavilyExtractHit[];
	failed_results?: TavilyExtractFailure[];
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalize one Tavily search hit; drop entries without a usable url + title. */
function toResult(hit: TavilySearchHit): SearchResult | undefined {
	const url = str(hit.url);
	const title = str(hit.title);
	if (!url || !title) return undefined;
	const snippet = str(hit.content);
	return snippet ? {title, url, snippet} : {title, url};
}

/** Resolve an endpoint path against the instance baseUrl. */
function endpoint(baseUrl: string, path: string): string {
	return new URL(
		path,
		baseUrl.endsWith('/') ? baseUrl : baseUrl + '/',
	).toString();
}

/**
 * Build a Tavily-compat backend bound to the configured instance. The returned
 * backend only ever touches the network via the injected `http` helper. A Bearer
 * header is added only when an apiKey is set (the covered instances are usually
 * keyless).
 */
export function createTavilyCompatBackend(config: Config): Backend {
	const baseUrl = config.baseUrl;
	const apiKey = config.apiKey;

	function headers(): Record<string, string> {
		const h: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json',
		};
		if (apiKey) h.authorization = `Bearer ${apiKey}`;
		return h;
	}

	function post(
		path: string,
		payload: unknown,
		signal?: AbortSignal,
	): HttpRequestOptions {
		return {
			method: 'POST',
			headers: headers(),
			body: JSON.stringify(payload),
			signal,
		};
	}

	return {
		async search(
			query: string,
			http: Http,
			options: SearchOptions = {},
		): Promise<SearchResult[]> {
			const payload: Record<string, unknown> = {query};
			if (options.maxResults !== undefined)
				payload.max_results = options.maxResults;
			const body = await http.fetchJson<TavilySearchResponse>(
				endpoint(baseUrl, 'search'),
				post('search', payload, options.signal),
			);
			const results = Array.isArray(body.results) ? body.results : [];
			const normalized = results
				.map(toResult)
				.filter((r): r is SearchResult => r !== undefined);
			return options.maxResults !== undefined
				? normalized.slice(0, options.maxResults)
				: normalized;
		},

		async fetch(
			url: string,
			http: Http,
			options: FetchOptions = {},
		): Promise<FetchResult> {
			// Tavily `/extract` has no `s/m/l/f` size knob (it has `format` /
			// `extract_depth` instead); always request markdown. The default
			// distilly Extractor owns webveil's size presets.
			const body = await http.fetchJson<TavilyExtractResponse>(
				endpoint(baseUrl, 'extract'),
				post('extract', {urls: url, format: 'markdown'}, options.signal),
			);
			const failure = (body.failed_results ?? []).find(
				(f) => str(f.url) === url,
			);
			if (failure)
				throw new Error(
					`tavily-compat: /extract failed for ${url}: ${str(failure.error) ?? 'unknown error'}`,
				);
			const hit = (body.results ?? [])[0];
			const markdown = hit ? str(hit.raw_content) : undefined;
			if (markdown === undefined)
				throw new Error(`tavily-compat: no extract result for ${url}`);
			// Tavily `/extract` returns no `truncated` flag and no page title.
			return {url, markdown, truncated: false};
		},
	};
}
