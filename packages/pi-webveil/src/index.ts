// pi-webveil — a pi extension exposing `web_search` and `web_fetch` tools backed
// by webveil's core. A drop-in, anonymity-capable replacement for Ollama's
// web_search/web_fetch: the tool NAMES are deliberately `web_search` and
// `web_fetch` (the Ollama drop-in), so installing this replaces
// `@ollama/pi-web-search` with nothing else to change (CONTEXT.md "drop-in").
//
// Both tools call webveil's exported `search()` / `fetch()` IN-PROCESS (no
// shelling). Per-folder config (.pi/webveil.json walking up from the folder) is
// resolved from `ctx.cwd`, so each folder is its own account/egress. An optional
// compact `renderResult` is the only TUI we add (no commands/widgets/statusline;
// see the PRD "Out of Scope").

import {
	search as coreSearch,
	fetch as coreFetch,
	type SearchResult,
	type FetchResult,
} from 'webveil';

/**
 * The two core functions the extension wraps, seamed so tests can inject fakes
 * and assert the tools route to the core WITHOUT any network. Defaults are the
 * real webveil core; mirrors the incur frontend's `CliDeps`.
 */
export interface PiWebveilDeps {
	search?: typeof coreSearch;
	fetch?: typeof coreFetch;
}

/**
 * The slice of pi's extension context the tools read. Only `cwd` (per-folder
 * config root) and the optional abort `signal` are used; typed narrowly so the
 * extension stays dependency-light (no hard dep on pi's runtime packages, which
 * keeps it a true drop-in).
 */
interface ToolCtx {
	cwd: string;
	signal?: AbortSignal;
}

/** A single text-content tool result, matching pi's `AgentToolResult` shape. */
interface ToolResult {
	content: {type: 'text'; text: string}[];
	details: unknown;
}

/** The minimal tool-definition surface pi's `registerTool` consumes. */
interface ToolDef {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ToolCtx,
	): Promise<ToolResult>;
	renderResult?(result: ToolResult): string[];
}

/** The slice of pi's `ExtensionAPI` the extension uses: just `registerTool`. */
interface PiLike {
	registerTool(tool: ToolDef): void;
}

/** JSON-schema params for `web_search` (Ollama-shaped: `query` + `max_results`). */
const SEARCH_PARAMS = {
	type: 'object',
	properties: {
		query: {type: 'string', description: 'The search query to look up.'},
		max_results: {
			type: 'integer',
			description: 'Maximum number of results to return.',
		},
	},
	required: ['query'],
	additionalProperties: false,
} as const;

/** JSON-schema params for `web_fetch` (Ollama-shaped: a single `url`). */
const FETCH_PARAMS = {
	type: 'object',
	properties: {
		url: {type: 'string', description: 'The URL to fetch as markdown.'},
	},
	required: ['url'],
	additionalProperties: false,
} as const;

/** Render a SearchResult[] as a compact numbered list for the model. */
function renderSearch(results: SearchResult[]): string {
	if (results.length === 0) return 'No results.';
	return results
		.map((r, i) => {
			const head = `${i + 1}. ${r.title}\n   ${r.url}`;
			return r.snippet ? `${head}\n   ${r.snippet}` : head;
		})
		.join('\n');
}

/** Render a FetchResult as its markdown, flagging truncation. */
function renderFetch(page: FetchResult): string {
	const body = page.title
		? `# ${page.title}\n\n${page.markdown}`
		: page.markdown;
	return page.truncated ? `${body}\n\n[truncated]` : body;
}

/** A text tool-result with structured `details` for logs/UI. */
function textResult(text: string, details: unknown): ToolResult {
	return {content: [{type: 'text', text}], details};
}

/**
 * Register `web_search` and `web_fetch`, both routing to the webveil core in
 * process with per-folder config resolved from `ctx.cwd`. The factory takes
 * injectable core deps so a test asserts the routing with fakes (no network).
 */
export default function piWebveil(pi: PiLike, deps: PiWebveilDeps = {}): void {
	const search = deps.search ?? coreSearch;
	const fetch = deps.fetch ?? coreFetch;

	pi.registerTool({
		name: 'web_search',
		label: 'Web Search',
		description:
			'Search the web via webveil (self-hosted, account-free, egress you control).',
		parameters: SEARCH_PARAMS,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const query = String(params.query ?? '');
			const max = params.max_results;
			const results = await search(query, {
				cwd: ctx.cwd,
				signal: signal ?? ctx.signal,
				maxResults: typeof max === 'number' ? max : undefined,
			});
			return textResult(renderSearch(results), {results});
		},
		renderResult(result) {
			return result.content
				.filter((c) => c.type === 'text')
				.flatMap((c) => c.text.split('\n'));
		},
	});

	pi.registerTool({
		name: 'web_fetch',
		label: 'Web Fetch',
		description:
			'Fetch a URL as clean, size-bounded markdown via webveil (egress you control).',
		parameters: FETCH_PARAMS,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const url = String(params.url ?? '');
			const page = await fetch(url, {
				cwd: ctx.cwd,
				signal: signal ?? ctx.signal,
			});
			return textResult(renderFetch(page), {page});
		},
		renderResult(result) {
			return result.content
				.filter((c) => c.type === 'text')
				.flatMap((c) => c.text.split('\n'));
		},
	});
}
