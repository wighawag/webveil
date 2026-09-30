// fetch transport: which transport `web_fetch` sends its requests over, and the
// `serpcast` one, a `fetch`-shaped adapter over serpcast's libcurl-impersonate
// transport (Chrome's TLS/HTTP2 fingerprint, the `document` header table). It is
// injected into distilly exactly where the plain guarded egress fetch is, so
// distilly's rules and pure core are unchanged (docs/adr/0001).
//
// Same egress: the FETCH-hop egress (`fetchEgress ?? egress`, ADR 0003), mapped
// as the serpcast backend maps its hop (`serpcastProxy`: SOCKS always
// `socks5h`). Same SSRF guarantee: serpcast's transport follows no redirects,
// so the adapter follows them and runs `assertPublicUrl` on EVERY hop before it
// is sent. Strict impersonation always (ADR 0004): no fingerprint, no fetch,
// never a fallback to `plain`.
//
// Recorded decisions (task web-fetch-via-serpcast-transport):
// - The key is `fetchTransport` (`plain` | `serpcast`, env
//   `WEBVEIL_FETCH_TRANSPORT`), named for the `fetch*` family (`fetchEgress`,
//   `fetchSize`). Unset, it follows `backend` (serpcast -> `serpcast`, else
//   `plain`: owner decision 2026-09-29); an explicit value always wins. Any
//   other value is an error, not a silent `plain`. Alternative considered:
//   a boolean `fetchImpersonate` (cannot name a later third transport).
// - Each request distilly makes (so each `web_fetch` url) starts with an empty
//   cookie jar: cookies are kept across that request's redirect hops (a site
//   may set one on the 302) and dropped after it. Nothing persists between
//   fetches and nothing is written to the serpcast state store: a fetch is not
//   a search identity, and cookies carried between fetched pages would link
//   them.
// - The caller's request headers are ignored (the Chrome `document` table is the
//   only header set; adding headers would break the fingerprint) and only GET is
//   sent (serpcast's transport has no other method). Redirects (301, 302, 303,
//   307, 308 with a Location) are followed, at most 20 (the WHATWG fetch limit),
//   and only to http(s). The hop gate and redirect rules are shared with the
//   plain guarded fetch (security.ts), so both transports check the same way.
// - The timeout and body size limit are serpcast's defaults (15 s, 16 MiB): no
//   new config keys. Their failures are serpcast errors, surfaced as is.
// - Only `serpcast.libcurlPath` is trust-checked here (trust.ts: checked where
//   used); `serpcast.engines` and the other keys are not needed or read.
// - The transport is cached per fetch identity (the fetch-hop egress plus the
//   resolved library path, hashed by `identityKey`); `closeFetchTransports`
//   (from `closeBackends`) drops the cache and closes its sessions.
//
// Recorded decisions (task serpcast-0-3-and-fetch-connection-reuse; owner
// decision 2026-09-29, reversing the serpcast-0-2-decoy-guard choice of one
// session per fetch, closed when it settles): connections are REUSED across
// fetches of the same fetch identity, cookies never are. A new TCP + TLS
// setup per fetch cost about 0.5 s over Tor versus about 0.09 s on a reused
// session (measured). The price: a site sees repeated fetches to it arrive on
// one TLS connection, which links them at the connection level; through one
// proxy or Tor circuit they already share an exit IP, and no cookie or other
// state is carried (README, fetch section).
// - A POOL of serpcast sessions per identity (`SessionPool`). A fetch takes an
//   idle session (else opens a new one), clears its cookies, runs its hops on
//   it, clears the cookies again and returns it. A busy session is never
//   shared, so concurrent fetches never see each other's cookies; they get
//   different sessions (and so different connections). Alternative
//   considered: one shared session with its jar cleared per fetch, rejected
//   because two concurrent fetches would share (and clear) one jar.
// - At most `MAX_IDLE_SESSIONS` (4) idle sessions are kept per identity; a
//   session returned beyond that is closed. This bounds the connections held
//   open after a burst of concurrent fetches.
// - An idle session is closed after `DEFAULT_SESSION_IDLE_MS` (serpcast's
//   session idle default, 10 minutes) without use, on an unref'd timer, so
//   neither the timer nor the idle connections (serpcast schedules nothing
//   for an idle session) keep the one-shot CLI alive. No config key: the
//   value is serpcast's, like the timeout and size limit above.
// - A fetch that fails (a transport error, a timeout, an abort, a refused
//   hop, too many redirects) CLOSES its session instead of returning it: a
//   connection left mid-transfer or broken is never handed to the next fetch,
//   and a failure is rare enough that the lost reuse does not matter.
// - `closeFetchTransports` closes every idle session at once; a session busy
//   at that moment is closed when its fetch settles (serpcast's `close()` would
//   wait for it anyway) and never returns to a pool.

import {
	createTransport as realCreateTransport,
	DEFAULT_SESSION_IDLE_MS,
	SerpcastError,
} from 'serpcast';
import type {
	Transport,
	TransportOptions,
	TransportResponse,
	TransportSession,
} from 'serpcast';
import type {Config, FetchTransport} from './config.js';
import type {EgressFetch} from './egress.js';
import {identityKey} from './identity.js';
import {
	DEFAULT_MAX_IDLE_SESSIONS,
	fetchMaxRedirects,
	fetchSerpcastTunables,
} from './tunables.js';
import {
	assertFetchableHop,
	assertPublicUrl as realAssertPublicUrl,
	isRedirectStatus,
	nextRedirectUrl,
} from './security.js';
import {
	impersonationFailure,
	serpcastProxy,
	trustedLibcurlPath,
} from './backends/serpcast.js';

/**
 * Test seams: how the transport is created, how a hop is SSRF-checked, how
 * long an idle session is kept (default `DEFAULT_SESSION_IDLE_MS`).
 */
export interface SerpcastFetchDeps {
	createTransport?: (options: TransportOptions) => Transport;
	assertPublicUrl?: (url: string, config: Config) => Promise<void>;
	sessionIdleMs?: number;
}

const TRANSPORTS: FetchTransport[] = ['plain', 'serpcast'];
const NULL_BODY = new Set([101, 103, 204, 205, 304]);
/** Idle sessions kept per fetch identity by default (`fetchSerpcast.maxIdleSessions`). */
export const MAX_IDLE_SESSIONS = DEFAULT_MAX_IDLE_SESSIONS;

/**
 * The sessions of one fetch identity: idle ones wait here (each with its
 * release timer); a busy one is owned by its fetch alone until it returns.
 */
class SessionPool {
	private idle: {session: TransportSession; timer: NodeJS.Timeout}[] = [];
	private closed = false;

	constructor(
		private transport: Transport,
		private idleMs: number,
		private maxIdle: number,
	) {}

	/** An idle session (else a new one), with an empty cookie jar. */
	take(): TransportSession {
		const entry = this.idle.pop();
		if (entry) clearTimeout(entry.timer);
		const session = entry?.session ?? this.transport.session();
		session.clearCookies();
		return session;
	}

	/** Back to the pool, cookies cleared; closed if unusable or not wanted. */
	release(session: TransportSession, reusable: boolean): void {
		session.clearCookies();
		if (!reusable || this.closed || this.idle.length >= this.maxIdle) {
			session.close();
			return;
		}
		const entry = {
			session,
			timer: setTimeout(() => {
				this.idle = this.idle.filter((e) => e !== entry);
				session.close();
			}, this.idleMs),
		};
		entry.timer.unref(); // an idle session never keeps the process alive
		this.idle.push(entry);
	}

	/** Close the idle sessions now; busy ones close when their fetch settles. */
	close(): void {
		this.closed = true;
		for (const {session, timer} of this.idle) {
			clearTimeout(timer);
			session.close();
		}
		this.idle = [];
	}
}

const pools = new Map<string, SessionPool>();

/** The `web_fetch` transport: explicit `fetchTransport`, else by `backend`. */
export function resolveFetchTransport(config: Config): FetchTransport {
	const value = config.fetchTransport;
	if (value === undefined)
		return config.backend === 'serpcast' ? 'serpcast' : 'plain';
	if (!TRANSPORTS.includes(value))
		throw new Error(
			`webveil: fetchTransport must be 'plain' or 'serpcast' (got '${String(value)}')`,
		);
	return value;
}

/** Close and drop the cached fetch transports (process shutdown; see closeBackends). */
export async function closeFetchTransports(): Promise<void> {
	for (const pool of pools.values()) pool.close();
	pools.clear();
}

/** The request's url and method, from any `fetch` input form. */
function target(input: RequestInfo | URL, init?: RequestInit) {
	const url =
		typeof input === 'string'
			? input
			: input instanceof URL
				? input.href
				: input.url;
	const method =
		init?.method ??
		(typeof input === 'object' && 'method' in input ? input.method : 'GET');
	return {url, method: method.toUpperCase()};
}

/** A transport response as a standard `Response` (its body is already decoded). */
function toResponse(r: TransportResponse, redirected: boolean): Response {
	const headers = new Headers(r.headers);
	headers.delete('content-encoding');
	headers.delete('content-length');
	const body = NULL_BODY.has(r.status) ? null : (r.body as BodyInit);
	const response = new Response(body, {status: r.status, headers});
	Object.defineProperty(response, 'url', {value: r.url});
	Object.defineProperty(response, 'redirected', {value: redirected});
	return response;
}

/**
 * Build the serpcast `fetch` for the FETCH-hop config (`fetchEgressConfig`).
 * Trust, library path and proxy are resolved here, before any I/O (fail loud,
 * like `createEgressFetch`); the returned fetch follows redirects itself with
 * the SSRF check on every hop.
 */
export function createSerpcastFetch(
	config: Config,
	deps: SerpcastFetchDeps = {},
): EgressFetch {
	const libcurlPath = trustedLibcurlPath(config);
	const proxy = serpcastProxy(config.egress);
	const assertPublicUrl = deps.assertPublicUrl ?? realAssertPublicUrl;
	const maxRedirects = fetchMaxRedirects(config);
	const {maxIdleSessions, sessionIdleMs, ...limits} =
		fetchSerpcastTunables(config);
	const idleMs = deps.sessionIdleMs ?? sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
	const key = identityKey(config.egress, {
		libcurlPath,
		...limits,
		maxIdleSessions,
		idleMs,
	});
	let pool = pools.get(key);
	if (!pool) {
		const create = deps.createTransport ?? realCreateTransport;
		pool = new SessionPool(
			create({
				libcurlPath,
				proxy,
				strict: true,
				...(limits.timeoutMs !== undefined && {timeoutMs: limits.timeoutMs}),
				...(limits.maxBodyBytes !== undefined && {
					maxBodyBytes: limits.maxBodyBytes,
				}),
				...(limits.reuseConnections !== undefined && {
					reuseConnections: limits.reuseConnections,
				}),
			}),
			idleMs,
			maxIdleSessions,
		);
		pools.set(key, pool);
	}
	const sessions = pool;
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		let {url, method} = target(input, init);
		if (method !== 'GET')
			throw new Error(
				`webveil: fetchTransport serpcast sends GET only (got ${method} ${url})`,
			);
		const session = sessions.take();
		const signal = init?.signal ?? undefined;
		let reusable = false;
		try {
			for (let hop = 0; ; hop++) {
				await assertFetchableHop(url, config, assertPublicUrl);
				const response = await session
					.request(url, {kind: 'document', ...(signal && {signal})})
					.catch((error: unknown) =>
						Promise.reject(
							error instanceof SerpcastError && error.kind === 'impersonation'
								? impersonationFailure(error)
								: error,
						),
					);
				const location = response.headers.get('location');
				if (!isRedirectStatus(response.status) || !location) {
					reusable = true;
					return toResponse(response, hop > 0);
				}
				url = nextRedirectUrl(location, url, hop, maxRedirects);
			}
		} finally {
			// The body is already read (toResponse): the session is free again.
			sessions.release(session, reusable);
		}
	}) as EgressFetch;
}
