// Extractor seam — turn a URL into clean, size-bounded markdown by calling
// distilly's NETWORKED `urlToMarkdown` (the `distilly/fetch` entrypoint),
// INJECTING webveil's egress-bound `fetch` as the only transport. distilly's
// network Rules (github/mdn/react.dev/vuejs.org) rewrite a matching URL to its
// raw `.md`/API source and fetch THAT over our egress — shorter, cleaner output;
// non-matching URLs run through distilly's pure core. See docs/adr/0001.
//
// THE HARD INVARIANT (load-bearing for anonymity): webveil ALWAYS injects its
// egress-bound `fetch` here and NEVER lets distilly use a global/default fetch.
// distilly throws if none is injected — the desired fail-loud. And the egress
// fetch itself throws (before any I/O) when a configured proxy is unbuildable
// (egress.ts), so a broken proxy can never become an un-proxied request.
//
// This is the DEFAULT extractor; a backend's own `/extract` (tavily-compat) may
// override it (wired in the core-fetch task).

import {urlToMarkdown as distillyUrlToMarkdown} from 'distilly/fetch';
import type {Config, FetchSize} from './config.js';
import {createEgressFetch, type EgressFetch} from './egress.js';
import type {FetchResult} from './backends/types.js';

/** The shape distilly's `urlToMarkdown` returns (the bits we surface). */
interface UrlToMarkdownResult {
	markdown: string;
	truncated: boolean;
}

/** distilly's networked entrypoint, narrowed to what the seam injects/uses. */
type UrlToMarkdown = (
	url: string | URL,
	options: {fetch: EgressFetch; size?: FetchSize},
) => Promise<UrlToMarkdownResult>;

/** Per-call extractor options. */
export interface ExtractOptions {
	/**
	 * Page-size budget for THIS call. Overrides the config's `fetchSize` when
	 * given. webveil's `s`/`m`/`l`/`f` preset maps STRAIGHT to distilly's `size`
	 * (the two enums are identical), so this is passed through verbatim.
	 */
	size?: FetchSize;
}

/**
 * Seams the extractor's collaborators so it is testable WITHOUT real network or
 * undici: tests inject a spy `urlToMarkdown` and/or a spy egress fetch to assert
 * distilly is called with the egress fetch (never a global). Defaults wire the
 * real `distilly/fetch` + `createEgressFetch`.
 */
export interface ExtractDeps {
	/** distilly's networked `urlToMarkdown` (default: the real `distilly/fetch`). */
	urlToMarkdown?: UrlToMarkdown;
	/** Builds the egress-bound fetch from config (default: createEgressFetch). */
	createEgressFetch?: (config: Config) => EgressFetch;
}

/**
 * Extract a URL to clean, budget-bounded markdown via distilly over webveil's
 * egress. Builds the egress-bound `fetch` (fail-loud on an unbuildable proxy),
 * injects it into distilly's `urlToMarkdown`, maps the `s`/`m`/`l`/`f` preset to
 * distilly's `size`, and surfaces distilly's `truncated`.
 *
 * @returns `{ url, markdown, truncated }` (a `FetchResult` without a `title`).
 */
export async function extract(
	url: string,
	config: Config,
	options: ExtractOptions = {},
	deps: ExtractDeps = {},
): Promise<FetchResult> {
	const urlToMarkdown = deps.urlToMarkdown ?? distillyUrlToMarkdown;
	const buildFetch = deps.createEgressFetch ?? createEgressFetch;

	// Build the egress-bound fetch FIRST: a configured-but-unbuildable proxy
	// throws here, before any network access (never an un-proxied request).
	const fetch = buildFetch(config);

	const size = options.size ?? config.fetchSize;

	const {markdown, truncated} = await urlToMarkdown(url, {fetch, size});
	return {url, markdown, truncated};
}
