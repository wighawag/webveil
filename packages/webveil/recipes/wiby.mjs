// A searchcast code recipe for Wiby (https://wiby.me), an independent search
// engine for the small, hobbyist and old-style web, free software (GPLv2,
// https://github.com/wibyweb/wiby), whose JSON API is public and keyless by
// design: the about page (https://wiby.me/about/) says "Developers can connect
// their applications to Wiby using the JSON output available at wiby.me/json",
// and the install guide calls it "a simple API for meta search engines to
// harness" (https://wiby.me/about/guide.html). Read 2026-10-24, with the
// API's own page (https://wiby.me/json/) and the privacy policy
// (https://wiby.me/about/pp.html).
//
// Terms of use (the API page, in full): "1. Use this service at your own
// risk. 2. Provide a link to wiby.me with the results." This recipe meets the
// second by ending every result's snippet with a link to https://wiby.me/ (see
// ATTRIBUTION below). No rate limit and no licence for the results are
// published; no key exists. Access logs are kept for up to 48 hours. Be
// gentle: it is a small, donation-funded service. This recipe does not pace
// requests itself: searchcast's cooldown after a 429 or 503 is the only brake.
//
// The API: `https://wiby.me/json/?q=<query>` answers a JSON array of
// `{URL, Title, Snippet, Description}`, at most 12 per page (`&p=<n>` for the
// next page, not used here; `&nsfw` would include results marked not safe for
// work, not used either). `Snippet` is the excerpt of the page around the
// query, which Wiby's own result page shows; `Description` is the page's
// description, used when there is no excerpt. The server fills the array from
// an HTML template (Go's html/template, per its source), so the strings come
// HTML-escaped (`&#34;`, `&amp;`, ...): they are decoded here.
//
// Bundled with webveil as the third engine of the default chain
// (`["mwmbl", "marginalia", "wiby"]`, used when no engines, recipes or code
// recipes are configured; owner-approved on 2026-10-24). Written for webveil
// (task bundled-wiby-wikipedia), not a copy of a searchcast example: searchcast
// has none for Wiby. It is trusted because it ships in the webveil package,
// not because of any config layer: a project webveil.json still cannot add
// code recipes.

const API = 'https://wiby.me/json/';

/** What every result's snippet ends with: Wiby's terms ask for a link to wiby.me with the results. */
export const ATTRIBUTION = 'via Wiby, https://wiby.me/';

const NAMED = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
};

/** Decode the HTML character references html/template writes (and a few named ones). */
function decode(text) {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref) => {
		if (ref[0] !== '#') return NAMED[ref.toLowerCase()] ?? match;
		const code =
			ref[1] === 'x' || ref[1] === 'X'
				? parseInt(ref.slice(2), 16)
				: parseInt(ref.slice(1), 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

/** A trimmed, decoded, non-empty string, else undefined. */
function text(value) {
	if (typeof value !== 'string') return undefined;
	const s = decode(value).replace(/\s+/g, ' ').trim();
	return s || undefined;
}

export default {
	name: 'wiby',
	async search(query, ctx) {
		const url = `${API}?q=${encodeURIComponent(query)}`;
		let data;
		try {
			data = await ctx.http.json(url, {kind: 'document'});
		} catch (error) {
			// ctx.http maps 429 to `blocked` already; a 503 (a `transport` error
			// there) means the service is overloaded, so it is `blocked` too (the
			// engine cools down instead of being retried at once).
			if (error?.kind === 'transport' && /\bHTTP 503\b/.test(error.message))
				ctx.blocked('HTTP 503, the service is overloaded');
			throw error;
		}
		if (!Array.isArray(data))
			ctx.recipeError('the API response is not a JSON array of results');
		const results = data
			.filter((r) => typeof r?.URL === 'string' && r.URL.trim())
			.map((r) => {
				const link = r.URL.trim();
				const excerpt = text(r.Snippet) ?? text(r.Description);
				return {
					title: text(r.Title) ?? link,
					url: link,
					snippet: excerpt ? `${excerpt} (${ATTRIBUTION})` : ATTRIBUTION,
				};
			});
		// The API takes no result count; cut here, like the engine chain does.
		return ctx.maxResults === undefined
			? results
			: results.slice(0, ctx.maxResults);
	},
};
