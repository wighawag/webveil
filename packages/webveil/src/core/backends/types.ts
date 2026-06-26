// backend seam — the contract every result source (searxng | tavily-compat |
// custom) implements. A Backend is HANDED a proxied `http` helper (bound to the
// configured egress dispatcher) so it physically cannot bypass the egress.

/** A single search hit. */
export interface SearchResult {
	title: string;
	url: string;
	snippet?: string;
}

/** A fetched, extracted page as budget-bounded markdown. */
export interface FetchResult {
	url: string;
	title?: string;
	markdown: string;
	truncated: boolean;
}

export interface SearchOptions {
	maxResults?: number;
	signal?: AbortSignal;
}

export interface FetchOptions {
	size?: 's' | 'm' | 'l' | 'f';
	signal?: AbortSignal;
}

/** Options the http helper accepts for a single request. */
export interface HttpRequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Per-request timeout in ms (the helper aborts past this). */
	timeoutMs?: number;
	signal?: AbortSignal;
}

/**
 * The proxied http helper handed to backends. Both methods route through the
 * egress dispatcher; a backend never gets un-proxied transport of its own.
 */
export interface Http {
	fetchJson<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T>;
	fetchText(url: string, options?: HttpRequestOptions): Promise<string>;
}

/**
 * A result/content source. `search` is required; `fetch` is optional (a backend
 * may override the default distilly Extractor with its own `/extract`). Both are
 * given the proxied `http` helper so they cannot escape the configured egress.
 */
export interface Backend {
	search(
		query: string,
		http: Http,
		options?: SearchOptions,
	): Promise<SearchResult[]>;
	fetch?(url: string, http: Http, options?: FetchOptions): Promise<FetchResult>;
}
