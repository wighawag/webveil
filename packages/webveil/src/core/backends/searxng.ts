// searxng backend — the keyless, self-hosted metasearch default. Queries a
// SearXNG instance's JSON API (`/search?format=json`) THROUGH the handed `http`
// helper (never a direct fetch, so egress is not bypassable) and normalizes the
// response into SearchResult[]. The response's `unresponsive_engines` is
// surfaced: partial engine failures annotate every result
// (`unresponsiveEngines`); zero results + failures is an outage and fails loud.

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
	/** Engines that failed this query, as reported by the instance. */
	unresponsive_engines?: unknown[];
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
 * Extract engine names from SearXNG's `unresponsive_engines`. Upstream reports
 * each failure as a JSON `[name, error]` pair (a serialized Python tuple;
 * `searx/webutils.get_translated_errors`). Strings and `{name}` objects are
 * tolerated so an upstream shape drift costs us some names, never a crash.
 */
function unresponsiveNames(entries: unknown[] | undefined): string[] {
	if (!Array.isArray(entries)) return [];
	const names: string[] = [];
	for (const entry of entries) {
		let name: unknown;
		if (typeof entry === 'string') name = entry;
		else if (Array.isArray(entry)) name = entry[0];
		else if (typeof entry === 'object' && entry !== null)
			name = (entry as {name?: unknown}).name;
		if (typeof name === 'string' && name.length > 0 && !names.includes(name))
			names.push(name);
	}
	return names;
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
			const unresponsive = unresponsiveNames(body.unresponsive_engines);
			// Engine-degradation surfacing (live incident 2026-09-16): engines that
			// hard-fail appear in `unresponsive_engines`, so a healthy-vs-degraded
			// answer is distinguishable — UNLESS zero results came back, in which
			// case the failures are the only signal left. The JSON response does not
			// report the instance's full engine list, so "zero results + failures"
			// is treated as an all-engines-down outage (the fail-loud path, like any
			// unavailable backend) rather than a confident empty answer. Honest
			// limit: a lone engine serving a junk "decoy SERP" reports no error at
			// all, so degradation is ANNOTATED below, never detected as junk.
			if (unresponsive.length > 0 && results.length === 0)
				throw new Error(
					`searxng: no results and engines unresponsive (${unresponsive.join(', ')}) — ` +
						'the instance cannot answer from this egress (engines refusing the ' +
						'egress IP, or a full outage); see docs/searxng-setup.md',
				);
			const normalized = results
				.map(toResult)
				.filter((r): r is SearchResult => r !== undefined);
			// Partial degradation: some engines down, others still answered. Do NOT
			// fail (partial results are still useful) — annotate every hit so no
			// consumer can mistake the degraded set for a clean one.
			if (unresponsive.length > 0)
				for (const r of normalized) r.unresponsiveEngines = unresponsive;
			return options.maxResults !== undefined
				? normalized.slice(0, options.maxResults)
				: normalized;
		},
	};
}
