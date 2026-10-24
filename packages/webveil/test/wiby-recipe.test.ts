// The bundled Wiby code recipe (task bundled-wiby-wikipedia), run by
// searchcast's own `runCodeRecipe` against hand-built answers of Wiby's JSON
// API (https://wiby.me/json/, shaped as its server's template writes them:
// a bare array of `{URL, Title, Snippet, Description}`, HTML-escaped). A fake
// transport session answers every request: no network.

import {describe, expect, it} from 'vitest';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCodeRecipe, runCodeRecipe, SearchcastError} from 'searchcast';
import type {RequestOptions, TransportSession} from 'searchcast';

const WIBY_RECIPE = join(
	fileURLToPath(new URL('..', import.meta.url)),
	'recipes',
	'wiby.mjs',
);
const VIA = 'via Wiby, https://wiby.me/';

/** A session answering every request with `status` and `body`; requests are recorded. */
function answering(status: number, body: string) {
	const requests: {url: string; options: RequestOptions}[] = [];
	const session = {
		async request(url: string, options: RequestOptions) {
			requests.push({url, options});
			return {
				url,
				status,
				headers: new Headers({'content-type': 'application/json'}),
				body: new TextEncoder().encode(body),
				text: () => body,
			};
		},
	} as unknown as Pick<TransportSession, 'request'>;
	return {session, requests};
}

async function run(
	status: number,
	body: unknown,
	options: {maxResults?: number; query?: string} = {},
) {
	const recipe = await loadCodeRecipe(WIBY_RECIPE);
	const fake = answering(
		status,
		typeof body === 'string' ? body : JSON.stringify(body),
	);
	const answer = runCodeRecipe(recipe, options.query ?? 'old web', {
		session: fake.session,
		maxResults: options.maxResults,
	});
	return {answer, requests: fake.requests};
}

/** `n` well-formed results. */
const many = (n: number) =>
	Array.from({length: n}, (_, i) => ({
		URL: `https://site${i}.example/`,
		Title: `Site ${i}`,
		Snippet: `excerpt ${i}`,
		Description: '',
	}));

describe('the bundled Wiby recipe', () => {
	it('is named wiby and asks the JSON API keyless, as a document request with no author headers', async () => {
		const recipe = await loadCodeRecipe(WIBY_RECIPE);
		expect(recipe.name).toBe('wiby');
		const {answer, requests} = await run(200, [], {query: 'old web & more'});
		await answer;
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe(
			'https://wiby.me/json/?q=old%20web%20%26%20more',
		);
		expect(requests[0].options.kind).toBe('document');
		expect(requests[0].options.headers).toBeUndefined();
	});

	it('maps results to title, url and snippet, decoding the HTML escapes, with the link to wiby.me its terms ask for', async () => {
		const {answer} = await run(200, [
			{
				URL: 'https://one.example/page.html',
				Title: 'Tom &amp; Jerry&#39;s &#34;page&#34;',
				Snippet: '  a  &lt;b&gt; excerpt\n here &#x263A; ',
				Description: 'unused when there is an excerpt',
			},
			{
				URL: 'http://two.example/',
				Title: '',
				Snippet: '',
				Description: 'the description',
			},
			{URL: 'https://three.example/', Title: 'Three'},
			{Title: 'no url'},
			{URL: '  ', Title: 'blank url'},
			null,
		]);
		expect((await answer).results).toEqual([
			{
				title: 'Tom & Jerry\'s "page"',
				url: 'https://one.example/page.html',
				snippet: `a <b> excerpt here \u263a (${VIA})`,
			},
			{
				title: 'http://two.example/',
				url: 'http://two.example/',
				snippet: `the description (${VIA})`,
			},
			{title: 'Three', url: 'https://three.example/', snippet: VIA},
		]);
	});

	it('an empty array is a genuine empty answer', async () => {
		const {answer} = await run(200, []);
		expect((await answer).results).toEqual([]);
	});

	it('honours maxResults (the API takes no count)', async () => {
		const {answer} = await run(200, many(12), {maxResults: 3});
		const {results} = await answer;
		expect(results.map((r) => r.url)).toEqual([
			'https://site0.example/',
			'https://site1.example/',
			'https://site2.example/',
		]);
		const all = await run(200, many(12));
		expect((await all.answer).results).toHaveLength(12);
	});

	for (const [what, body] of [
		['an object, not an array', {results: many(2)}],
		['null', 'null'],
		[
			'not JSON (an HTML page)',
			'<!DOCTYPE html><html><body>busy</body></html>',
		],
	] as const) {
		it(`an unexpected answer (${what}) is a recipe error, so the chain falls through`, async () => {
			const {answer} = await run(200, body);
			const error = await answer.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(SearchcastError);
			expect((error as SearchcastError).kind).toBe('recipe');
		});
	}

	for (const status of [429, 503]) {
		it(`HTTP ${status} is blocked (the engine cools down)`, async () => {
			const {answer} = await run(status, '');
			const error = await answer.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(SearchcastError);
			expect((error as SearchcastError).kind).toBe('blocked');
		});
	}

	it('HTTP 500 is a transport error', async () => {
		const {answer} = await run(500, '');
		const error = await answer.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SearchcastError);
		expect((error as SearchcastError).kind).toBe('transport');
	});
});
