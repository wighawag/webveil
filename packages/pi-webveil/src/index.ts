// pi-webveil — a pi extension exposing `web_search` and `web_fetch` tools backed
// by webveil's core. A drop-in, anonymity-capable replacement for Ollama's
// web_search/web_fetch: the tool NAMES are deliberately `web_search` and
// `web_fetch` (the Ollama drop-in), so installing this replaces
// `@ollama/pi-web-search` with nothing else to change (CONTEXT.md "drop-in").
//
// Both tools call webveil's exported `search()` / `fetch()` IN-PROCESS (no
// shelling). Per-folder config (the frontend-neutral `webveil.json` walking up
// from the folder) is resolved from `ctx.cwd`, so each folder is its own
// account/egress. We add NO
// custom TUI: pi's default text renderer displays the tool result's text content
// (no commands/widgets/statusline; see the spec "Out of Scope").

import {
	closeBackends as coreCloseBackends,
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
	closeBackends?: typeof coreCloseBackends;
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
	/** pi's UI, when there is one: config warnings are notified there too. */
	ui?: {notify?(message: string, type?: 'info' | 'warning' | 'error'): void};
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
}

/** The slice of pi's `ExtensionAPI` the extension uses. */
interface PiLike {
	registerTool(tool: ToolDef): void;
	on?(event: 'session_shutdown', handler: () => Promise<void>): void;
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
	const body = results
		.map((r, i) => {
			const head = `${i + 1}. ${r.title}\n   ${r.url}`;
			return r.snippet ? `${head}\n   ${r.snippet}` : head;
		})
		.join('\n');
	// Engine-degradation surfacing: some engines were down while others
	// answered. Say so in the text the model reads — partial results are still
	// useful, but they must not read as a clean answer. Honest limit: webveil
	// cannot detect junk results (a decoy SERP parses like a real one), so this
	// warns "fewer engines answered", not "these results are good".
	const unresponsiveEngines = results.find(
		(r) => r.unresponsiveEngines !== undefined,
	)?.unresponsiveEngines;
	return unresponsiveEngines
		? `${body}\n\n[warning] search degraded — unresponsive engines: ${unresponsiveEngines.join(', ')}. Results come from the remaining engines only and may be skewed or junk.`
		: body;
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
 * Config warnings (webveil's deprecated `serpcast` spellings), each surfaced
 * ONCE per extension runtime: notified in pi's UI when there is one, and
 * appended to the text of the tool result that met it, so a run without a UI
 * (print or RPC mode) still shows it.
 *
 * Recorded decision (task rename-serpcast-spellings): both, not only the UI
 * notification, since `ctx.ui` may be absent or a no-op; the warning is in
 * the tool text once, so the model can relay it, and never again. The core's
 * default (stderr) is not used: it would write into pi's terminal UI.
 * Alternative considered: stderr (garbles the TUI) or the UI only (lost
 * without one).
 */
function warningSink(shown: Set<string>) {
	const fresh: string[] = [];
	/** The fresh warnings as text lines (now shown), notified in the UI. */
	const take = (ctx: ToolCtx): string | undefined => {
		const messages = fresh.filter((m) => !shown.has(m));
		fresh.length = 0;
		if (messages.length === 0) return undefined;
		for (const message of messages) {
			shown.add(message);
			ctx.ui?.notify?.(message, 'warning');
		}
		return messages.map((m) => `[warning] ${m}`).join('\n');
	};
	return {
		onWarning(message: string) {
			if (!shown.has(message)) fresh.push(message);
		},
		/** Run the tool; its result (or its error) carries the fresh warnings. */
		async surface(
			ctx: ToolCtx,
			run: () => Promise<ToolResult>,
		): Promise<ToolResult> {
			let result: ToolResult;
			try {
				result = await run();
			} catch (error) {
				const note = take(ctx);
				if (note && error instanceof Error)
					error.message = `${error.message}\n\n${note}`;
				throw error;
			}
			const note = take(ctx);
			if (!note) return result;
			const text = result.content.map((c) => c.text).join('\n');
			return textResult(`${text}\n\n${note}`, result.details);
		},
	};
}

/**
 * Register `web_search` and `web_fetch`, both routing to the webveil core in
 * process with per-folder config resolved from `ctx.cwd`. The factory takes
 * injectable core deps so a test asserts the routing with fakes (no network).
 */
export default function piWebveil(pi: PiLike, deps: PiWebveilDeps = {}): void {
	const search = deps.search ?? coreSearch;
	const fetch = deps.fetch ?? coreFetch;
	const closeBackends = deps.closeBackends ?? coreCloseBackends;
	const shownWarnings = new Set<string>();

	// The core caches long-lived backend state across calls (the searchcast
	// instance, so cooldowns and sessions survive between searches); release it
	// when pi tears the extension runtime down, so nothing is left running.
	// Recorded decision (task serpcast-backend-basic): close on EVERY
	// `session_shutdown` (quit, reload, new, resume, fork), not only `quit`: a
	// torn-down runtime must not leave an instance (later a browser) behind, at
	// the cost of in-memory cooldowns across `/new` (the planned on-disk state
	// store keeps them). `on` is optional so a minimal host still works.
	pi.on?.('session_shutdown', () => closeBackends());

	pi.registerTool({
		name: 'web_search',
		label: 'Web Search',
		description:
			'Search the web via webveil (self-hosted, account-free, egress you control).',
		parameters: SEARCH_PARAMS,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const query = String(params.query ?? '');
			const max = params.max_results;
			const warnings = warningSink(shownWarnings);
			return warnings.surface(ctx, async () => {
				const results = await search(query, {
					cwd: ctx.cwd,
					signal: signal ?? ctx.signal,
					maxResults: typeof max === 'number' ? max : undefined,
					onWarning: warnings.onWarning,
				});
				return textResult(renderSearch(results), {results});
			});
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
			const warnings = warningSink(shownWarnings);
			return warnings.surface(ctx, async () => {
				const page = await fetch(url, {
					cwd: ctx.cwd,
					signal: signal ?? ctx.signal,
					onWarning: warnings.onWarning,
				});
				return textResult(renderFetch(page), {page});
			});
		},
	});
}
