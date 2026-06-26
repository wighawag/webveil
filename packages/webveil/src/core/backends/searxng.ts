// searxng backend — the keyless, self-hosted metasearch default. Queries a
// SearXNG instance's JSON API (`/search?format=json`) THROUGH the handed `http`
// helper (never a direct fetch, so egress is not bypassable) and normalizes the
// response into SearchResult[].

import type {Config} from '../config.js';
import type {Backend, Http, SearchOptions, SearchResult} from './types.js';

/** The shape of one entry in a SearXNG JSON `results` array (subset we use). */
interface SearxngResult {
	url?: unknown;
	title?: unknown;
	content?: unknown;
}

/** The SearXNG JSON API response (subset we use). */
interface SearxngResponse {
	results?: SearxngResult[];
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalize one SearXNG hit; drop entries without a usable url + title. */
function toResult(hit: SearxngResult): SearchResult | undefined {
	const url = str(hit.url);
	const title = str(hit.title);
	if (!url || !title) return undefined;
	const snippet = str(hit.content);
	return snippet ? {title, url, snippet} : {title, url};
}

/** Build the SearXNG JSON search URL for a query against the instance baseUrl. */
function buildUrl(baseUrl: string, query: string): string {
	const url = new URL(
		'search',
		baseUrl.endsWith('/') ? baseUrl : baseUrl + '/',
	);
	url.searchParams.set('q', query);
	url.searchParams.set('format', 'json');
	return url.toString();
}

/**
 * Build a SearXNG backend bound to the configured instance. The returned backend
 * only ever touches the network via the injected `http` helper.
 */
export function createSearxngBackend(config: Config): Backend {
	const baseUrl = config.baseUrl;
	return {
		async search(
			query: string,
			http: Http,
			options: SearchOptions = {},
		): Promise<SearchResult[]> {
			const body = await http.fetchJson<SearxngResponse>(
				buildUrl(baseUrl, query),
				{headers: {accept: 'application/json'}, signal: options.signal},
			);
			const results = Array.isArray(body.results) ? body.results : [];
			const normalized = results
				.map(toResult)
				.filter((r): r is SearchResult => r !== undefined);
			return options.maxResults !== undefined
				? normalized.slice(0, options.maxResults)
				: normalized;
		},
	};
}
