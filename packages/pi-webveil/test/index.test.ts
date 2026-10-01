// The pi extension wires `web_search` / `web_fetch` to the SAME framework-
// agnostic core (webveil's `search()` / `fetch()`) the incur frontend calls.
// These tests assert that wiring WITHOUT any network: the core functions are
// injected as fakes (the factory's deps), a fake `pi.registerTool` captures the
// two tool definitions, and we assert the names + that executing each tool calls
// the fake core with the parsed args and the per-folder `cwd` from `ctx.cwd`.

import {describe, expect, it, vi} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import piWebveil from '../src/index.js';
import {
	closeBackends,
	createSearchcastBackend,
	search as coreSearch,
} from 'webveil';
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
		ctx: {
			cwd: string;
			signal?: AbortSignal;
			ui?: {notify(message: string, type?: string): void};
		},
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

describe('pi-webveil: registration', () => {
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

describe('pi-webveil: web_search routes to core.search', () => {
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

	it('renders a degradation warning in the text when engines were down', async () => {
		// Some engines unresponsive, others answered: partial results are still
		// useful, but the model must not read them as a clean answer.
		const search = vi.fn(async () => [
			{...hit, unresponsiveEngines: ['engine-b', 'engine-c']},
		]);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search});
		const result = await tools
			.get('web_search')!
			.execute('id', {query: 'q'}, undefined, undefined, {cwd: '/w'});
		const text = result.content.map((c) => c.text).join('\n');
		expect(text).toContain('[warning] search degraded');
		expect(text).toContain('engine-b, engine-c');
	});

	it('renders NO degradation warning for a clean answer', async () => {
		const search = vi.fn(async () => [hit]);
		const {pi, tools} = fakePi();
		piWebveil(pi, {search});
		const result = await tools
			.get('web_search')!
			.execute('id', {query: 'q'}, undefined, undefined, {cwd: '/w'});
		const text = result.content.map((c) => c.text).join('\n');
		expect(text).not.toContain('search degraded');
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

describe('pi-webveil: web_fetch routes to core.fetch', () => {
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

describe('pi-webveil: no live network', () => {
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

describe('pi-webveil: searchcast backend through the real core', () => {
	it('returns results from a searchcast project config and closes at shutdown', async () => {
		const root = mkdtempSync(join(tmpdir(), 'pi-webveil-searchcast-'));
		try {
			mkdirSync(join(root, 'recipes'));
			writeFileSync(
				join(root, 'recipes', 'e.json'),
				JSON.stringify({
					navigate: {url: 'https://e.test/?q={query}'},
					ready: '.r',
					results: {item: '.r', fields: {title: {}, url: {attr: 'href'}}},
				}),
			);
			writeFileSync(
				join(root, 'webveil.json'),
				JSON.stringify({
					backend: 'searchcast',
					searchcast: {engines: ['e'], recipes: ['recipes']},
				}),
			);
			const created: unknown[] = [];
			const closed: unknown[] = [];
			const createSearchcast = (options: unknown) => {
				created.push(options);
				return {
					search: async () => ({
						results: [{title: 'Hit', url: 'https://example.com/hit'}],
						engine: 'e',
						failures: [],
					}),
					clearSessions: async () => {},
					close: async () => void closed.push(1),
				};
			};
			const search: typeof coreSearch = (query, options) =>
				coreSearch(
					query,
					{...options, globalPath: join(root, 'global.json'), env: {}},
					{
						getBackend: (_name, config) =>
							createSearchcastBackend(config, {createSearchcast}),
					},
				);
			const shutdown: (() => Promise<void>)[] = [];
			const {pi, tools} = fakePi();
			piWebveil(
				{
					...pi,
					on: (_event: string, handler: () => Promise<void>) =>
						void shutdown.push(handler),
				},
				{search, closeBackends},
			);
			const tool = tools.get('web_search')!;
			for (let i = 0; i < 2; i++) {
				const result = await tool.execute(
					'id',
					{query: 'q'},
					undefined,
					undefined,
					{cwd: root},
				);
				expect(result.content[0]!.text).toContain('https://example.com/hit');
			}
			expect(created).toHaveLength(1); // one cached instance for both calls
			expect(closed).toHaveLength(0);
			expect(shutdown).toHaveLength(1);
			await shutdown[0]!();
			expect(closed).toHaveLength(1);
		} finally {
			rmSync(root, {recursive: true, force: true});
		}
	});
});

describe('pi-webveil: deprecated serpcast spellings', () => {
	it('surfaces each warning once (UI notification and tool text), with the real core', async () => {
		const root = mkdtempSync(join(tmpdir(), 'pi-webveil-spellings-'));
		try {
			writeFileSync(
				join(root, 'webveil.json'),
				JSON.stringify({backend: 'serpcast', serpcast: {engines: ['e']}}),
			);
			const search: typeof coreSearch = (query, options) =>
				coreSearch(
					query,
					{...options, globalPath: join(root, 'global.json'), env: {}},
					{
						getBackend: () => ({
							search: async () => [
								{title: 'Hit', url: 'https://example.com/hit'},
							],
						}),
					},
				);
			const {pi, tools} = fakePi();
			piWebveil(pi, {search});
			const notified: [string, string | undefined][] = [];
			const ctx = {
				cwd: root,
				ui: {notify: (m: string, t?: string) => void notified.push([m, t])},
			};
			const tool = tools.get('web_search')!;
			const first = await tool.execute(
				'id',
				{query: 'q'},
				undefined,
				undefined,
				ctx,
			);
			const text = first.content[0]!.text;
			expect(text).toContain('https://example.com/hit');
			expect(text).toContain('[warning] webveil: `serpcast`');
			expect(text).toContain('use `backend: "searchcast"` instead');
			expect(notified).toHaveLength(2);
			expect(notified.every(([, type]) => type === 'warning')).toBe(true);
			const second = await tool.execute(
				'id',
				{query: 'q'},
				undefined,
				undefined,
				ctx,
			);
			expect(second.content[0]!.text).not.toContain('[warning]');
			expect(notified).toHaveLength(2);
		} finally {
			rmSync(root, {recursive: true, force: true});
		}
	});

	it('appends the warning to the error when the tool fails, without a UI', async () => {
		const {pi, tools} = fakePi();
		piWebveil(pi, {
			fetch: (url, options) => {
				options?.onWarning?.('webveil: a test warning');
				return Promise.reject(new Error(`cannot fetch ${url}`));
			},
		});
		const tool = tools.get('web_fetch')!;
		const error = await tool
			.execute('id', {url: 'https://example.com/'}, undefined, undefined, {
				cwd: '/tmp',
			})
			.catch((e: Error) => e);
		expect((error as Error).message).toBe(
			'cannot fetch https://example.com/\n\n[warning] webveil: a test warning',
		);
	});
});
