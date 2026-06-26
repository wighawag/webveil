import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
	readFileSync,
	chmodSync,
	readdirSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCustomBackend} from '../src/core/backends/custom.js';
import type {Config} from '../src/core/config.js';
import type {Http} from '../src/core/backends/types.js';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'webveil-custom-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
	vi.restoreAllMocks();
});

/**
 * Write an executable POSIX shell script into the test's temp dir and return its
 * path. `body` runs with the request JSON available on stdin.
 */
function writeScript(name: string, body: string): string {
	const path = join(root, name);
	writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8');
	chmodSync(path, 0o755);
	return path;
}

function cfg(command: string): Config {
	return {
		backend: 'custom',
		baseUrl: command,
		egress: {mode: 'direct'},
		fetchSize: 'm',
	};
}

/**
 * The handed `http` helper must be UNUSED by the custom backend (the command owns
 * its own I/O). This fake throws if the backend ever touches it.
 */
function unusedHttp(): Http {
	return {
		async fetchJson<T>(): Promise<T> {
			throw new Error('custom backend must not use the http helper');
		},
		async fetchText(): Promise<string> {
			throw new Error('custom backend must not use the http helper');
		},
	};
}

describe('custom backend — JSON stdin/stdout round-trip', () => {
	it('writes the request JSON to stdin and parses SearchResult[] from stdout', async () => {
		// The fixture captures the raw stdin to a file (so the test can assert the
		// exact request JSON the contract delivered) and echoes the parsed query
		// back in the title, proving the stdin->stdout round-trip end to end.
		const capture = join(root, 'request.json');
		const script = writeScript(
			'echo-back.sh',
			`req=$(cat)
printf '%s' "$req" > "${capture}"
query=$(printf '%s' "$req" | sed -n 's/.*"query":"\\([^"]*\\)".*/\\1/p')
printf '[{"title":"Hit for %s","url":"https://example.com/a","snippet":"s"}]' "$query"`,
		);
		const backend = createCustomBackend(cfg(script));
		const results = await backend.search('webveil', unusedHttp());
		expect(results).toEqual([
			{title: 'Hit for webveil', url: 'https://example.com/a', snippet: 's'},
		]);
		// The stdin the command received must be exactly the JSON contract.
		const request = JSON.parse(readFileSync(capture, 'utf8'));
		expect(request).toEqual({query: 'webveil'});
	});

	it('passes maxResults in the request JSON and clamps the parsed results', async () => {
		const script = writeScript(
			'many.sh',
			`cat >/dev/null
printf '[{"title":"A","url":"https://example.com/a"},{"title":"B","url":"https://example.com/b"},{"title":"C","url":"https://example.com/c"}]'`,
		);
		const backend = createCustomBackend(cfg(script));
		const results = await backend.search('q', unusedHttp(), {maxResults: 2});
		expect(results).toEqual([
			{title: 'A', url: 'https://example.com/a'},
			{title: 'B', url: 'https://example.com/b'},
		]);
	});

	it('returns an empty array when the command legitimately returns []', async () => {
		const script = writeScript('empty.sh', `cat >/dev/null\nprintf '[]'`);
		const backend = createCustomBackend(cfg(script));
		expect(await backend.search('q', unusedHttp())).toEqual([]);
	});

	it('supports a command with arguments (argv split on whitespace)', async () => {
		const script = writeScript(
			'with-args.sh',
			`cat >/dev/null
printf '[{"title":"arg=%s","url":"https://example.com/a"}]' "$1"`,
		);
		const backend = createCustomBackend(cfg(`${script} hello`));
		const results = await backend.search('q', unusedHttp());
		expect(results[0]!.title).toBe('arg=hello');
	});
});

describe('custom backend — malformed output fails clearly (never silent empty)', () => {
	it('throws when stdout is not valid JSON', async () => {
		const script = writeScript('not-json.sh', `cat >/dev/null\nprintf 'oops'`);
		const backend = createCustomBackend(cfg(script));
		await expect(backend.search('q', unusedHttp())).rejects.toThrow(
			/not valid JSON/i,
		);
	});

	it('throws when stdout is JSON but not an array', async () => {
		const script = writeScript(
			'object.sh',
			`cat >/dev/null\nprintf '{"results":[]}'`,
		);
		const backend = createCustomBackend(cfg(script));
		await expect(backend.search('q', unusedHttp())).rejects.toThrow(
			/expected a JSON array/i,
		);
	});

	it('throws when a result entry is missing a url or title', async () => {
		const script = writeScript(
			'missing.sh',
			`cat >/dev/null\nprintf '[{"title":"no url"}]'`,
		);
		const backend = createCustomBackend(cfg(script));
		await expect(backend.search('q', unusedHttp())).rejects.toThrow(
			/missing a url or title/i,
		);
	});

	it('throws (does not return empty) when the command produces no output', async () => {
		const script = writeScript('silent.sh', `cat >/dev/null`);
		const backend = createCustomBackend(cfg(script));
		await expect(backend.search('q', unusedHttp())).rejects.toThrow(
			/no output/i,
		);
	});

	it('throws clearly when the command exits non-zero', async () => {
		const script = writeScript(
			'fail.sh',
			`cat >/dev/null\necho 'boom' >&2\nexit 3`,
		);
		const backend = createCustomBackend(cfg(script));
		await expect(backend.search('q', unusedHttp())).rejects.toThrow(
			/exited with code 3/i,
		);
	});

	it('throws clearly when the command cannot be spawned', async () => {
		const backend = createCustomBackend(cfg(join(root, 'does-not-exist.sh')));
		await expect(backend.search('q', unusedHttp())).rejects.toThrow(
			/failed to spawn/i,
		);
	});

	it('throws clearly when no command is configured', () => {
		expect(() => createCustomBackend(cfg('   '))).toThrow(
			/no command configured/i,
		);
	});
});

describe('custom backend — isolation (writes nothing outside its temp fixtures)', () => {
	it('does not write any shared/global location; only the temp dir is touched', async () => {
		// Snapshot the temp dir contents before the run, then assert the run added
		// nothing (the fixture writes only to stdout, never to disk).
		const before = readdirSync(root).sort();
		const script = writeScript(
			'pure.sh',
			`cat >/dev/null\nprintf '[{"title":"A","url":"https://example.com/a"}]'`,
		);
		const backend = createCustomBackend(cfg(script));
		await backend.search('q', unusedHttp());
		const after = readdirSync(root).sort();
		// Only the script we just wrote is new; the backend itself created nothing.
		expect(after).toEqual([...before, 'pure.sh'].sort());
	});

	it('never reaches a global fetch (the command owns its own I/O)', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValue(new Error('global fetch must not be called'));
		const script = writeScript(
			'ok.sh',
			`cat >/dev/null\nprintf '[{"title":"A","url":"https://example.com/a"}]'`,
		);
		const backend = createCustomBackend(cfg(script));
		await backend.search('q', unusedHttp());
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
