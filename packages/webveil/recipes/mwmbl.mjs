// An example searchcast code recipe for Mwmbl (https://mwmbl.org), a
// non-profit, open-source (AGPL-3.0) independent search engine whose search API
// is public and keyless by design: https://developer.mwmbl.org/ (read
// 2026-09-30).
//
// Limits and terms, in short: without a key, the API allows 1,000 requests a
// month at 1 request per second, counted per IP address, so everyone behind the
// same Tor exit or VPN shares that quota. An optional personal key (set it in
// MWMBL_API_KEY) raises it; it goes in the `api_key` query parameter. Over the
// quota the API answers HTTP 429. Mwmbl's terms (https://mwmbl.org/terms)
// forbid scraping and excessive automated queries, and its data is under
// CC BY-NC-SA 4.0. This recipe does not pace requests itself: searchcast's
// cooldown after a 429 is the only brake.
//
// The key is part of the URL, so it appears in searchcast's error messages
// (they name the URL): keep that in mind when you log failures.
//
// Bundled with webveil as the first engine of the default chain
// (`["mwmbl", "marginalia"]`, used when no engines, recipes or code recipes
// are configured; owner-approved on 2026-09-30). Source: a copy of searchcast's
// examples/recipes/mwmbl.mjs at commit
// 7b0dbde7daf7b50cf99f6b7846b75e34db18602f
// (https://github.com/wighawag/searchcast/blob/7b0dbde7daf7b50cf99f6b7846b75e34db18602f/examples/recipes/mwmbl.mjs).
// It is trusted because it ships in the webveil package, not because of any
// config layer: a project webveil.json still cannot add code recipes.

const API = 'https://api.mwmbl.org/api/v2/search/';

export default {
	name: 'mwmbl',
	async search(query, ctx) {
		let url = `${API}?q=${encodeURIComponent(query)}`;
		const key = process.env.MWMBL_API_KEY;
		if (key) url += `&api_key=${encodeURIComponent(key)}`;
		let data;
		try {
			data = await ctx.http.json(url, {kind: 'document'});
		} catch (error) {
			// ctx.http maps 429 (the quota) to `blocked` already; a 503 (a
			// `transport` error there) means the service is overloaded, so it is
			// `blocked` too (the engine cools down instead of being retried at once).
			if (error?.kind === 'transport' && /\bHTTP 503\b/.test(error.message))
				ctx.blocked('HTTP 503, the service is overloaded');
			throw error;
		}
		if (!Array.isArray(data?.results))
			ctx.recipeError('no "results" array in the API response');
		const results = data.results
			.filter((r) => typeof r?.url === 'string' && r.url)
			.map((r) => ({
				title: typeof r.title === 'string' && r.title ? r.title : r.url,
				url: r.url,
				...(typeof r.content === 'string' && r.content && {snippet: r.content}),
			}));
		// The API takes no result count; cut here, like the engine chain does.
		return ctx.maxResults === undefined
			? results
			: results.slice(0, ctx.maxResults);
	},
};
