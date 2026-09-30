// web_fetch's transport choice (`fetchTransport`) and the serpcast transport
// adapter, driven through the core fetch() with REAL distilly and real config
// files over a FAKE serpcast transport: no native library and no network. The
// SSRF guard is the real one: direct-egress targets are literal public IPs, so
// no DNS lookup happens either.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {
	createTransport as realCreateTransport,
	DEFAULT_SESSION_IDLE_MS,
	SerpcastError,
} from 'serpcast';
import type {Transport, TransportOptions, TransportResponse} from 'serpcast';
import type {Config} from '../src/core/config.js';
import {resolveConfig} from '../src/core/config.js';
import {fetch} from '../src/core/fetch.js';
import type {FetchDeps} from '../src/core/fetch.js';
import {
	closeFetchTransports,
	createSerpcastFetch,
	MAX_IDLE_SESSIONS,
	resolveFetchTransport,
} from '../src/core/fetch-transport.js';
import {closeBackends} from '../src/core/backends/registry.js';
import type {Backend} from '../src/core/backends/types.js';
import type {EgressFetch} from '../src/core/egress.js';
import {SsrfError} from '../src/core/security.js';
import {TrustError} from '../src/core/trust.js';

const realGlobal = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
	'webveil',
	'config.json',
);
let realGlobalExisted: boolean;
let root: string;
let globalPath: string;
let project: string;

beforeEach(() => {
	realGlobalExisted = existsSync(realGlobal);
	root = mkdtempSync(join(tmpdir(), 'webveil-fetch-transport-'));
	globalPath = join(root, 'xdg', 'webveil', 'config.json');
	project = join(root, 'repo');
	mkdirSync(project, {recursive: true});
});

afterEach(async () => {
	await closeFetchTransports();
	rmSync(root, {recursive: true, force: true});
	expect(existsSync(realGlobal)).toBe(realGlobalExisted);
});

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(value), 'utf8');
}

const PAGE = 'https://93.184.215.14/page';

/** One canned answer of the fake transport. */
interface Answer {
	status?: number;
	headers?: Record<string, string>;
	html?: string;
	error?: Error;
}

/**
 * A fake serpcast transport answering per url; records options, requests and
 * closed sessions. Each session has its own cookie jar: a `set-cookie` answer
 * header adds to it, and `cookieRequests` records the cookies each request was
 * sent with. An answer with `gate` waits for it before answering.
 */
function fakeTransport(
	answers: Record<string, Answer & {gate?: Promise<void>}> = {},
) {
	const built: TransportOptions[] = [];
	const requests: {url: string; kind: string; session: number}[] = [];
	const cookieRequests: {url: string; session: number; cookies: string[]}[] =
		[];
	const closed: number[] = [];
	let sessions = 0;
	const create = (options: TransportOptions): Transport => {
		built.push(options);
		return {
			check: async () => ({
				path: '/fake',
				version: 'x',
				target: 'chrome146',
				impersonating: true,
			}),
			session() {
				const session = ++sessions;
				let jar: string[] = [];
				return {
					async request(url, options): Promise<TransportResponse> {
						requests.push({url, kind: options.kind, session});
						cookieRequests.push({url, session, cookies: [...jar]});
						const a = answers[url] ?? {};
						if (a.gate) await a.gate;
						if (a.error) throw a.error;
						const set = a.headers?.['set-cookie'];
						if (set) jar.push(set);
						const html =
							a.html ?? `<html><body><h1>at ${url}</h1></body></html>`;
						return {
							url,
							status: a.status ?? 200,
							headers: new Headers({
								'content-type': 'text/html',
								...a.headers,
							}),
							body: new TextEncoder().encode(html),
							text: () => html,
						};
					},
					cookies: () => [],
					clearCookies() {
						jar = [];
					},
					close() {
						closed.push(session);
					},
				};
			},
		};
	};
	return {create, built, requests, cookieRequests, closed};
}

type Fake = ReturnType<typeof fakeTransport>;

/** core fetch() over real config files, the serpcast adapter on the fake. */
function fetchWith(
	fake: Fake,
	env: Record<string, string> = {},
	url = PAGE,
	extra: FetchDeps = {},
) {
	return fetch(
		url,
		{cwd: project, globalPath, env},
		{
			createSerpcastFetch: (config) =>
				createSerpcastFetch(config, {createTransport: fake.create}),
			...extra,
		},
	);
}

function cfg(overrides: Partial<Config> = {}): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress: {mode: 'direct'},
		fetchSize: 'm',
		...overrides,
	};
}

describe('fetchTransport: resolution', () => {
	it('defaults to serpcast with the serpcast backend, plain otherwise', () => {
		expect(resolveFetchTransport(cfg({backend: 'serpcast'}))).toBe('serpcast');
		for (const backend of ['searxng', 'tavily-compat', 'custom'])
			expect(resolveFetchTransport(cfg({backend}))).toBe('plain');
	});

	it('an explicit value always wins over the backend default', () => {
		expect(
			resolveFetchTransport(
				cfg({backend: 'serpcast', fetchTransport: 'plain'}),
			),
		).toBe('plain');
		expect(resolveFetchTransport(cfg({fetchTransport: 'serpcast'}))).toBe(
			'serpcast',
		);
	});

	it('reads the key from files and WEBVEIL_FETCH_TRANSPORT (env wins)', () => {
		writeJson(join(project, 'webveil.json'), {
			backend: 'serpcast',
			fetchTransport: 'plain',
		});
		const opts = {cwd: project, globalPath};
		expect(resolveFetchTransport(resolveConfig({...opts, env: {}}))).toBe(
			'plain',
		);
		const env = {WEBVEIL_FETCH_TRANSPORT: 'serpcast'};
		expect(resolveFetchTransport(resolveConfig({...opts, env}))).toBe(
			'serpcast',
		);
	});

	it('refuses an unknown value (never a silent plain)', () => {
		expect(() =>
			resolveFetchTransport(cfg({fetchTransport: 'curl' as never})),
		).toThrow(/fetchTransport must be 'plain' or 'serpcast'/);
	});
});

describe('fetchTransport serpcast: distilly over the impersonated transport', () => {
	it('is the default with the serpcast backend (no engines needed), GET document', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport({[PAGE]: {html: '<h1>Hello serpcast</h1>'}});
		const result = await fetchWith(fake);
		expect(result.markdown).toContain('Hello serpcast');
		expect(fake.requests).toEqual([{url: PAGE, kind: 'document', session: 1}]);
		expect(fake.built[0]).toMatchObject({strict: true});
		expect(fake.built[0]!.proxy).toBeUndefined();
	});

	it('works with another backend when set explicitly, and plain never runs', async () => {
		writeJson(join(project, 'webveil.json'), {fetchTransport: 'serpcast'});
		const createEgressFetch = vi.fn();
		const fake = fakeTransport();
		await fetchWith(fake, {}, PAGE, {
			createEgressFetch: createEgressFetch as never,
		});
		expect(fake.requests).toHaveLength(1);
		expect(createEgressFetch).not.toHaveBeenCalled();
	});

	it('maps the FETCH-hop egress: fetchEgress socks5 -> socks5h, over egress', async () => {
		writeJson(join(project, 'webveil.json'), {
			backend: 'serpcast',
			egress: {mode: 'http', url: 'http://proxy.example:3128'},
			fetchEgress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'},
		});
		const fake = fakeTransport();
		await fetchWith(fake);
		expect(fake.built[0]!.proxy).toBe('socks5h://127.0.0.1:9050');
	});

	it('passes an http egress through as is', async () => {
		writeJson(join(project, 'webveil.json'), {
			backend: 'serpcast',
			egress: {mode: 'http', url: 'http://proxy.example:3128'},
		});
		const fake = fakeTransport();
		await fetchWith(fake);
		expect(fake.built[0]!.proxy).toBe('http://proxy.example:3128');
	});

	it('follows redirects (relative too) in one session, and reports the final url', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const second = 'https://93.184.215.14/moved';
		const final = 'https://1.1.1.1/final';
		const fake = fakeTransport({
			[PAGE]: {status: 301, headers: {location: '/moved'}},
			[second]: {status: 302, headers: {location: final}},
			[final]: {html: '<h1>Arrived</h1>'},
		});
		const adapter = createSerpcastFetch(
			resolveConfig({cwd: project, globalPath, env: {}}),
			{
				createTransport: fake.create,
			},
		);
		const response = await adapter(PAGE);
		expect(response.status).toBe(200);
		expect(response.url).toBe(final);
		expect(response.redirected).toBe(true);
		expect(await response.text()).toContain('Arrived');
		expect(fake.requests.map((r) => [r.url, r.session])).toEqual([
			[PAGE, 1],
			[second, 1],
			[final, 1],
		]);
		// The session goes back to the pool, still open for the next fetch.
		expect(fake.closed).toEqual([]);
	});

	it('runs the SSRF check on every hop: a redirect to a private address is refused before it is sent', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport({
			[PAGE]: {
				status: 302,
				headers: {location: 'http://169.254.169.254/latest'},
			},
		});
		await expect(fetchWith(fake)).rejects.toThrow(SsrfError);
		expect(fake.requests.map((r) => r.url)).toEqual([PAGE]);
		// A failed fetch closes its session: never handed to the next fetch.
		expect(fake.closed).toEqual([1]);
	});

	it('refuses a private first hop on direct egress, before any request', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport();
		await expect(fetchWith(fake, {}, 'http://127.0.0.1:8080/')).rejects.toThrow(
			SsrfError,
		);
		expect(fake.requests).toHaveLength(0);
	});

	it('stops after 20 redirects', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport({
			[PAGE]: {status: 307, headers: {location: PAGE}},
		});
		await expect(fetchWith(fake)).rejects.toThrow(/too many redirects/);
		expect(fake.requests).toHaveLength(21);
	});

	it('refuses a redirect to a non-http(s) url', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport({
			[PAGE]: {status: 302, headers: {location: 'file:///etc/passwd'}},
		});
		await expect(fetchWith(fake)).rejects.toThrow(/non-http\(s\)/);
		expect(fake.requests).toHaveLength(1);
	});

	it('sends GET only, and ignores the caller headers', async () => {
		const fake = fakeTransport();
		const adapter = createSerpcastFetch(cfg(), {createTransport: fake.create});
		await expect(adapter(PAGE, {method: 'POST'})).rejects.toThrow(/GET only/);
		await adapter(new Request(PAGE, {headers: {'x-leak': 'me'}}));
		expect(fake.requests).toEqual([{url: PAGE, kind: 'document', session: 1}]);
	});

	it('surfaces a size or timeout failure as an error', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const big = new SerpcastError(
			'transport',
			'response is larger than 16777216 bytes',
		);
		const failing = fakeTransport({[PAGE]: {error: big}});
		await expect(fetchWith(failing)).rejects.toThrow(/larger than/);
		expect(failing.closed).toEqual([1]); // closed on a failed request too
		await closeFetchTransports();
		const slow = new SerpcastError('timeout', `request to ${PAGE} timed out`);
		await expect(
			fetchWith(fakeTransport({[PAGE]: {error: slow}})),
		).rejects.toThrow(/timed out/);
	});

	it('a non-2xx final status is distilly error (as on the plain path)', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport({[PAGE]: {status: 403}});
		await expect(fetchWith(fake)).rejects.toThrow(/status 403/);
	});

	it('a backend /extract (tavily-compat) still wins over the transport', async () => {
		const fake = fakeTransport();
		const backend: Backend = {
			search: async () => [],
			fetch: async (url) => ({url, markdown: 'from backend', truncated: false}),
		};
		const result = await fetch(
			PAGE,
			{},
			{
				resolveConfig: () =>
					cfg({backend: 'tavily-compat', fetchTransport: 'serpcast'}),
				getBackend: () => backend,
				createSerpcastFetch: (c) =>
					createSerpcastFetch(c, {createTransport: fake.create}),
			},
		);
		expect(result.markdown).toBe('from backend');
		expect(fake.built).toHaveLength(0);
	});
});

describe('fetchTransport serpcast: impersonation', () => {
	it('fails loud with the fix when libcurl-impersonate is missing, never falling back to plain', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const plain = vi.fn() as unknown as EgressFetch;
		const error = await fetch(
			PAGE,
			{
				cwd: project,
				globalPath,
				env: {WEBVEIL_SERPCAST_LIBCURL_PATH: join(root, 'missing.so')},
			},
			{
				createEgressFetch: () => plain,
				// The REAL serpcast transport: its strict check fails before I/O.
				createSerpcastFetch: (c) =>
					createSerpcastFetch(c, {createTransport: realCreateTransport}),
			},
		).catch((e: Error) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain('impersonation is not active');
		expect(error.message).toContain('webveil install-libcurl');
		expect(plain).not.toHaveBeenCalled();
	});
});

describe('fetchTransport serpcast: the libcurl path is an executable setting', () => {
	it('is refused from a project webveil.json, naming the file', async () => {
		writeJson(join(project, 'webveil.json'), {
			backend: 'serpcast',
			serpcast: {libcurlPath: '/opt/libcurl-impersonate.so'},
		});
		const fake = fakeTransport();
		const error = await fetchWith(fake).catch((e: Error) => e);
		expect(error).toBeInstanceOf(TrustError);
		expect(error.message).toContain(join(project, 'webveil.json'));
		expect(error.message).toContain('serpcast.libcurlPath');
		expect(fake.built).toHaveLength(0);
	});

	it('is still refused on the derived (fetchEgress) config', async () => {
		writeJson(join(project, 'webveil.json'), {
			backend: 'serpcast',
			fetchEgress: {mode: 'socks5', url: 'socks5://127.0.0.1:9050'},
			serpcast: {libcurlPath: '/opt/libcurl-impersonate.so'},
		});
		const fake = fakeTransport();
		await expect(fetchWith(fake)).rejects.toThrow(TrustError);
		expect(fake.built).toHaveLength(0);
	});

	it('is used from the global config, resolved relative to that file', async () => {
		writeJson(globalPath, {serpcast: {libcurlPath: 'lib/libcurl.so'}});
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport();
		await fetchWith(fake);
		expect(fake.built[0]!.libcurlPath).toBe(
			join(dirname(globalPath), 'lib', 'libcurl.so'),
		);
	});

	it('is used from env only when absolute (never the cwd)', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport();
		await fetchWith(fake, {WEBVEIL_SERPCAST_LIBCURL_PATH: '/abs/libcurl.so'});
		expect(fake.built[0]!.libcurlPath).toBe('/abs/libcurl.so');
		await expect(
			fetchWith(fake, {WEBVEIL_SERPCAST_LIBCURL_PATH: 'rel.so'}),
		).rejects.toThrow(TrustError);
	});
});

describe('fetchTransport serpcast: transport reuse', () => {
	it('caches one transport per fetch identity, dropped by closeBackends', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport();
		await fetchWith(fake);
		await fetchWith(fake);
		expect(fake.built).toHaveLength(1);
		await fetchWith(fake, {
			WEBVEIL_FETCH_EGRESS: 'socks5',
			WEBVEIL_FETCH_EGRESS_URL: 'socks5://127.0.0.1:9050',
		});
		expect(fake.built).toHaveLength(2);
		await closeBackends();
		await fetchWith(fake);
		expect(fake.built).toHaveLength(3);
	});
});

describe('fetchTransport serpcast: connection reuse, never cookies', () => {
	const OTHER = 'https://1.1.1.1/other';
	const TOR = {
		WEBVEIL_FETCH_EGRESS: 'socks5',
		WEBVEIL_FETCH_EGRESS_URL: 'socks5://127.0.0.1:9050',
	};

	it('two sequential fetches of one identity reuse one session; another egress never shares it', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const fake = fakeTransport();
		await fetchWith(fake);
		await fetchWith(fake, {}, OTHER);
		expect(fake.requests.map((r) => r.session)).toEqual([1, 1]);
		expect(fake.closed).toEqual([]);
		await fetchWith(fake, TOR);
		expect(fake.built).toHaveLength(2);
		expect(fake.requests.at(-1)!.session).toBe(2);
		await fetchWith(fake);
		expect(fake.requests.at(-1)!.session).toBe(1);
	});

	it('each fetch starts with no cookies, even after the previous one received some; hops of one fetch share them', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		const moved = 'https://93.184.215.14/moved';
		const fake = fakeTransport({
			[PAGE]: {
				status: 302,
				headers: {location: '/moved', 'set-cookie': 'sid=first'},
			},
			[moved]: {headers: {'set-cookie': 'late=1'}},
		});
		await fetchWith(fake);
		await fetchWith(fake, {}, OTHER);
		expect(fake.cookieRequests).toEqual([
			{url: PAGE, session: 1, cookies: []},
			{url: moved, session: 1, cookies: ['sid=first']},
			{url: OTHER, session: 1, cookies: []},
		]);
	});

	it('two concurrent fetches get different sessions and never see each other cookies', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		let open!: () => void;
		const gate = new Promise<void>((resolve) => (open = resolve));
		const fake = fakeTransport({
			[PAGE]: {gate, headers: {'set-cookie': 'a=1'}},
			[OTHER]: {headers: {'set-cookie': 'b=2'}},
		});
		const first = fetchWith(fake);
		await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
		await fetchWith(fake, {}, OTHER); // while the first is still in flight
		open();
		await first;
		expect(fake.requests.map((r) => [r.url, r.session])).toEqual([
			[PAGE, 1],
			[OTHER, 2],
		]);
		// Both sessions are idle now, each with an empty jar.
		await Promise.all([fetchWith(fake), fetchWith(fake, {}, OTHER)]);
		expect(fake.cookieRequests.slice(2).map((r) => r.cookies)).toEqual([
			[],
			[],
		]);
		expect(fake.built).toHaveLength(1);
	});

	it('closes a session idle for sessionIdleMs, on a timer, and opens a new one after', async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeTransport();
			const adapter = createSerpcastFetch(cfg(), {
				createTransport: fake.create,
				sessionIdleMs: 1000,
			});
			await adapter(PAGE);
			vi.advanceTimersByTime(999);
			expect(fake.closed).toEqual([]);
			await adapter(PAGE); // use resets the idle clock
			vi.advanceTimersByTime(999);
			expect(fake.closed).toEqual([]);
			vi.advanceTimersByTime(1);
			expect(fake.closed).toEqual([1]);
			await adapter(PAGE);
			expect(fake.requests.map((r) => r.session)).toEqual([1, 1, 2]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses serpcast session idle default, on a timer that never keeps the process alive', async () => {
		const spy = vi.spyOn(globalThis, 'setTimeout');
		try {
			const fake = fakeTransport();
			await createSerpcastFetch(cfg(), {createTransport: fake.create})(PAGE);
			const call = spy.mock.results.findIndex(
				(_, i) => spy.mock.calls[i]![1] === DEFAULT_SESSION_IDLE_MS,
			);
			expect(call).toBeGreaterThanOrEqual(0);
			const timer = spy.mock.results[call]!.value as NodeJS.Timeout;
			expect(timer.hasRef()).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it('closeBackends closes the idle sessions; a session busy then closes when its fetch settles', async () => {
		writeJson(join(project, 'webveil.json'), {backend: 'serpcast'});
		let open!: () => void;
		const gate = new Promise<void>((resolve) => (open = resolve));
		const fake = fakeTransport({[OTHER]: {gate}});
		await fetchWith(fake); // session 1, now idle
		const busy = fetchWith(fake, {}, OTHER); // session 1 again, in flight
		await vi.waitFor(() => expect(fake.requests).toHaveLength(2));
		await fetchWith(fake); // session 2, idle
		await closeBackends();
		expect(fake.closed).toEqual([2]);
		open();
		await busy;
		expect(fake.closed).toEqual([2, 1]);
	});

	it(`keeps at most ${MAX_IDLE_SESSIONS} idle sessions per identity`, async () => {
		let open!: () => void;
		const gate = new Promise<void>((resolve) => (open = resolve));
		const fake = fakeTransport({[PAGE]: {gate}});
		const adapter = createSerpcastFetch(cfg(), {createTransport: fake.create});
		const all = Array.from({length: MAX_IDLE_SESSIONS + 2}, () =>
			adapter(PAGE),
		);
		open();
		await Promise.all(all);
		expect(fake.closed).toHaveLength(2);
	});
});

describe('fetchTransport plain', () => {
	it('keeps the undici path with the serpcast backend when set to plain', async () => {
		writeJson(join(project, 'webveil.json'), {
			backend: 'serpcast',
			fetchTransport: 'plain',
		});
		const fake = fakeTransport();
		const plain = vi.fn(
			async () =>
				new Response('<h1>plain</h1>', {
					headers: {'content-type': 'text/html'},
				}),
		) as unknown as EgressFetch;
		const result = await fetchWith(fake, {}, PAGE, {
			createEgressFetch: () => plain,
		});
		expect(result.markdown).toContain('plain');
		expect(plain).toHaveBeenCalledTimes(1);
		expect(fake.built).toHaveLength(0);
	});
});
