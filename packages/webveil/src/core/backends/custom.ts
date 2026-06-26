// custom backend — the local-command escape hatch (contract lifted from
// pi-web-providers' custom-wrapper). Instead of an HTTP source, it spawns a
// configured local command, writes the request as JSON to its stdin, and parses
// `SearchResult[]` from its stdout. This lets any local script be a backend.
//
// Egress note: this backend owns its own I/O (the spawned command does whatever
// it wants), so the handed `http` helper is unused here — there is no outbound
// HTTP for webveil to proxy. It still returns the normalized SearchResult shape.
//
// Command source: the configured `baseUrl` carries the command line, parsed as a
// whitespace-separated argv (first token = executable, rest = args), matching how
// the other backends read `baseUrl` as "where results come from". (Recorded
// decision; see the task's Decisions block.)
//
// Contract:
//   stdin  <- JSON: {"query": string, "maxResults"?: number}
//   stdout -> JSON: SearchResult[]  (each {title, url, snippet?})
// Malformed stdout (non-JSON, not an array, or entries missing url/title) FAILS
// CLEARLY — it never silently returns an empty list.

import {spawn as defaultSpawn} from 'node:child_process';
import type {Config} from '../config.js';
import type {Backend, Http, SearchOptions, SearchResult} from './types.js';

/** The JSON request written to the command's stdin. */
interface CustomRequest {
	query: string;
	maxResults?: number;
}

/** The result of running the command: its stdout text (and exit status). */
interface CommandRun {
	stdout: string;
	stderr: string;
	code: number | null;
}

/**
 * Minimal `spawn` shape this backend needs, seamed so a test can inject a fake
 * without a real subprocess. Defaults to `node:child_process` `spawn`.
 */
export type SpawnFn = typeof defaultSpawn;

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Parse the configured command line into [executable, ...args]. */
function parseCommand(baseUrl: string): [string, string[]] {
	const parts = baseUrl.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0)
		throw new Error(
			'custom: no command configured (set baseUrl to the command to run)',
		);
	return [parts[0]!, parts.slice(1)];
}

/**
 * Normalize one stdout entry into a SearchResult, FAILING CLEARLY on a malformed
 * entry rather than dropping it — the custom contract is explicit, so a missing
 * url/title is a contract violation the user should see, not a silent skip.
 */
function toResult(entry: unknown, index: number): SearchResult {
	if (typeof entry !== 'object' || entry === null)
		throw new Error(
			`custom: malformed output — result[${index}] is not an object`,
		);
	const hit = entry as Record<string, unknown>;
	const url = str(hit.url);
	const title = str(hit.title);
	if (!url || !title)
		throw new Error(
			`custom: malformed output — result[${index}] is missing a url or title`,
		);
	const snippet = str(hit.snippet);
	return snippet ? {title, url, snippet} : {title, url};
}

/** Parse the command's stdout into SearchResult[], failing clearly on garbage. */
function parseOutput(stdout: string): SearchResult[] {
	const trimmed = stdout.trim();
	if (trimmed.length === 0)
		throw new Error('custom: command produced no output');
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (cause) {
		throw new Error(
			`custom: malformed output — stdout is not valid JSON: ${(cause as Error).message}`,
		);
	}
	if (!Array.isArray(parsed))
		throw new Error(
			'custom: malformed output — expected a JSON array of results',
		);
	return parsed.map(toResult);
}

/** Spawn the command, write the request to stdin, and collect stdout/stderr. */
function runCommand(
	spawn: SpawnFn,
	exe: string,
	args: string[],
	request: CustomRequest,
	signal?: AbortSignal,
): Promise<CommandRun> {
	return new Promise<CommandRun>((resolve, reject) => {
		const child = spawn(exe, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			signal,
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
		child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
		child.on('error', (err) =>
			reject(new Error(`custom: failed to spawn '${exe}': ${err.message}`)),
		);
		child.on('close', (code) => resolve({stdout, stderr, code}));
		child.stdin?.on('error', () => {
			// A command that exits before reading stdin closes the pipe; ignore the
			// EPIPE here and let the close handler report via exit code/stderr.
		});
		child.stdin?.end(JSON.stringify(request));
	});
}

/**
 * Build a custom backend bound to the configured command. The command owns its
 * own I/O; webveil hands it the request as JSON on stdin and parses
 * SearchResult[] from stdout, failing clearly on malformed output.
 */
export function createCustomBackend(
	config: Config,
	spawn: SpawnFn = defaultSpawn,
): Backend {
	const [exe, args] = parseCommand(config.baseUrl);
	return {
		async search(
			query: string,
			_http: Http,
			options: SearchOptions = {},
		): Promise<SearchResult[]> {
			const request: CustomRequest = {query};
			if (options.maxResults !== undefined)
				request.maxResults = options.maxResults;
			const run = await runCommand(spawn, exe, args, request, options.signal);
			if (run.code !== 0)
				throw new Error(
					`custom: command '${exe}' exited with code ${run.code}` +
						(run.stderr.trim() ? `: ${run.stderr.trim()}` : ''),
				);
			const results = parseOutput(run.stdout);
			return options.maxResults !== undefined
				? results.slice(0, options.maxResults)
				: results;
		},
	};
}
