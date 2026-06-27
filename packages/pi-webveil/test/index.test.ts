// The pi extension wires `web_search` / `web_fetch` to the SAME framework-
// agnostic core (webveil's `search()` / `fetch()`) the incur frontend calls.
// These tests assert that wiring WITHOUT any network: the core functions are
// injected as fakes (the factory's deps), a fake `pi.registerTool` captures the
// two tool definitions, and we assert the names + that executing each tool calls
// the fake core with the parsed args and the per-folder `cwd` from `ctx.cwd`.

import {describe, expect, it, vi} from 'vitest';
import piWebveil from '../src/index.js';
import type {SearchResult, FetchResult} from 'webveil';

/** A captured tool registration (what `pi.registerTool` was handed). */
interface CapturedTool {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	execute(
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: {cwd: string; signal?: AbortSignal},
	): Promise<{content: {type: string; text: string}[]; details: unknown}>;
}

/** A fake `pi` whose `registerTool` records every definition by name. */
function fakePi() {
	const tools = new Map<string, CapturedTool>();
	const pi = {
		registerTool(tool: CapturedTool) {
			tools.set(tool.name, tool);
		},
	};
	return {pi, tools};
}

const hit: SearchResult = {
	title: 'Webveil',
	url: 'https://example.com/a',
	snippet: 'anonymous web search',
};
const page: FetchResult = {
	url: 'https://example.com/p',
	title: 'Example',
	markdown: '# Example\n\nbody',
	truncated: false,
};

describe('pi-webveil — registration', () => {
	it('registers EXACTLY two tools named web_search and web_fetch', () => {
		const {pi, tools} = fakePi();
		piWebveil(pi);
		expect([...tools.keys()].sort()).toEqual(['web_fetch', 'web_search']);
		expect(tools.size).toBe(2);
	});

	it('the registered tools carry the Ollama drop-in parameter shape', () => {
		const {pi, tools} = fakePi();
		piWebveil(pi);
		const search = tools.get('web_search')!;
		const fetch = tools.get('web_fetch')!;
		expect(search.parameters).toMatchObject({
			properties: {query: {type: 'string'}},
			required: ['query'],
		});
		expect(fetch.parameters).toMatchObject({
			properties: {url: {type: 'string'}},
			required: ['url'],
		});
	});
});

describe('pi-webveil — web_search routes to core.search', () => {
	it('calls core.search with the query and the per-folder cwd from ctx.cwd', async () => {
		const search = vi.fn(async () => [hit]);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search});

		const result = await tools
			.get('web_search')!
			.execute('id1', {query: 'hello world'}, undefined, undefined, {
				cwd: '/work/project-a',
			});

		expect(search).toHaveBeenCalledTimes(1);
		const [query, options] = search.mock.calls[0]!;
		expect(query).toBe('hello world');
		expect(options).toMatchObject({cwd: '/work/project-a'});
		// The hit reaches the text content returned to the model.
		const text = result.content.map((c) => c.text).join('\n');
		expect(text).toContain('example.com/a');
		expect(text).toContain('Webveil');
	});

	it('forwards max_results to the core options', async () => {
		const search = vi.fn(async () => [hit]);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search});
		await tools
			.get('web_search')!
			.execute('id', {query: 'q', max_results: 3}, undefined, undefined, {
				cwd: '/w',
			});
		expect(search.mock.calls[0]![1]).toMatchObject({maxResults: 3});
	});

	it('omits maxResults when max_results is not passed (core default applies)', async () => {
		const search = vi.fn(async () => [hit]);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search});
		await tools
			.get('web_search')!
			.execute('id', {query: 'q'}, undefined, undefined, {cwd: '/w'});
		expect(search.mock.calls[0]![1]?.maxResults).toBeUndefined();
	});

	it('does not call core.fetch for a search', async () => {
		const search = vi.fn(async () => [hit]);
		const fetch = vi.fn(async () => page);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search, fetch});
		await tools
			.get('web_search')!
			.execute('id', {query: 'q'}, undefined, undefined, {cwd: '/w'});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('forwards the abort signal to the core', async () => {
		const search = vi.fn(async () => [hit]);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search});
		const controller = new AbortController();
		await tools
			.get('web_search')!
			.execute('id', {query: 'q'}, controller.signal, undefined, {cwd: '/w'});
		expect(search.mock.calls[0]![1]?.signal).toBe(controller.signal);
	});
});

describe('pi-webveil — web_fetch routes to core.fetch', () => {
	it('calls core.fetch with the url and the per-folder cwd from ctx.cwd', async () => {
		const fetch = vi.fn(async () => page);
		const {pi, tools} = fakePi();
		piWebveil(pi, {fetch});

		const result = await tools
			.get('web_fetch')!
			.execute('id', {url: 'https://example.com/p'}, undefined, undefined, {
				cwd: '/work/project-b',
			});

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]![0]).toBe('https://example.com/p');
		expect(fetch.mock.calls[0]![1]).toMatchObject({cwd: '/work/project-b'});
		const text = result.content.map((c) => c.text).join('\n');
		expect(text).toContain('Example');
		expect(text).toContain('body');
	});

	it('does not call core.search for a fetch', async () => {
		const search = vi.fn(async () => [hit]);
		const fetch = vi.fn(async () => page);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search, fetch});
		await tools
			.get('web_fetch')!
			.execute('id', {url: 'https://example.com'}, undefined, undefined, {
				cwd: '/w',
			});
		expect(search).not.toHaveBeenCalled();
	});

	it('flags truncated pages in the rendered markdown', async () => {
		const fetch = vi.fn(async () => ({...page, truncated: true}));
		const {pi, tools} = fakePi();
		piWebveil(pi, {fetch});
		const result = await tools
			.get('web_fetch')!
			.execute('id', {url: 'https://example.com'}, undefined, undefined, {
				cwd: '/w',
			});
		const text = result.content.map((c) => c.text).join('\n');
		expect(text).toContain('[truncated]');
	});
});

describe('pi-webveil — no live network', () => {
	it('never reaches a global fetch when routing to fake core', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('global fetch must not be called'));
		const search = vi.fn(async () => [hit]);
		const fetch = vi.fn(async () => page);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search, fetch});
		await tools
			.get('web_search')!
			.execute('id', {query: 'q'}, undefined, undefined, {cwd: '/w'});
		await tools
			.get('web_fetch')!
			.execute('id', {url: 'https://example.com'}, undefined, undefined, {
				cwd: '/w',
			});
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});
});
