// webveil — anonymous-capable, self-hosted, account-free web search + fetch for agents.
//
// Placeholder surface. The real implementation (built by tasks from the PRD) is one
// framework-agnostic core with two thin frontends:
//   - core/search.ts, core/fetch.ts  : plain functions (frontend-agnostic)
//   - core/backends/*                 : backend seam (searxng | tavily-compat | custom)
//   - core/egress.ts                  : egress seam (direct | http | socks5/Tor)
//   - core/config.ts                  : per-folder .pi/webveil.json + global + env
//   - core/extract.ts                 : Extractor seam -> distilly (MIT) by default
//   - cli.ts                          : incur Cli.create() -> CLI + MCP + skills
// pi-webveil (sibling package) wraps the SAME core functions as registerTool
// web_search / web_fetch, in-process, as an Ollama drop-in.

export interface SearchResult {
	title: string;
	url: string;
	snippet?: string;
}

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

export async function search(
	_query: string,
	_options: SearchOptions = {},
): Promise<SearchResult[]> {
	throw new Error('webveil: search not implemented yet (see work/prds/ready)');
}

export async function fetch(
	_url: string,
	_options: FetchOptions = {},
): Promise<FetchResult> {
	throw new Error('webveil: fetch not implemented yet (see work/prds/ready)');
}
