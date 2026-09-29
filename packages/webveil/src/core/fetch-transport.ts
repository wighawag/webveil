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
// - One fresh transport session per request distilly makes (so per `web_fetch`
//   url): cookies are kept across that request's redirect hops (a site may set
//   one on the 302) and dropped after it. Nothing persists between fetches and
//   nothing is written to the serpcast state store: a fetch is not a search
//   identity, and cookies carried between fetched pages would link them.
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
//   (from `closeBackends`) drops the cache. Each fetch closes its own session
//   (below), so the cached transport holds no connection between fetches and
//   there is nothing else to close.
//
// Recorded decision (task serpcast-0-2-decoy-guard): serpcast 0.2 keeps a
// session's connections open between its requests until `session.close()`.
// A fetch still gets one session of its own (its redirect hops reuse its
// connections), and closes it when the fetch settles, whatever the outcome.
// Reusing one session (or its connections) across fetches was considered and
// rejected: a kept connection would link fetches of unrelated pages at the TLS
// and IP layer, the same reason cookies are not carried between them, and a
// never-closed session would leak its connections until the server drops
// them. Search sessions are the serpcast instance's business (reused per
// engine, per identity: backends/serpcast.ts).

import {createTransport as realCreateTransport, SerpcastError} from 'serpcast';
import type {Transport, TransportOptions, TransportResponse} from 'serpcast';
import type {Config, FetchTransport} from './config.js';
import type {EgressFetch} from './egress.js';
import {identityKey} from './identity.js';
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

/** Test seams: how the transport is created, how a hop is SSRF-checked. */
export interface SerpcastFetchDeps {
	createTransport?: (options: TransportOptions) => Transport;
	assertPublicUrl?: (url: string, config: Config) => Promise<void>;
}

const TRANSPORTS: FetchTransport[] = ['plain', 'serpcast'];
const NULL_BODY = new Set([101, 103, 204, 205, 304]);
const transports = new Map<string, Transport>();

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

/** Drop the cached fetch transports (process shutdown; see closeBackends). */
export async function closeFetchTransports(): Promise<void> {
	transports.clear();
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
	const key = identityKey(config.egress, {libcurlPath});
	let transport = transports.get(key);
	if (!transport) {
		const create = deps.createTransport ?? realCreateTransport;
		transport = create({libcurlPath, proxy, strict: true});
		transports.set(key, transport);
	}
	const shared = transport;
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		let {url, method} = target(input, init);
		if (method !== 'GET')
			throw new Error(
				`webveil: fetchTransport serpcast sends GET only (got ${method} ${url})`,
			);
		const session = shared.session();
		const signal = init?.signal ?? undefined;
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
				if (!isRedirectStatus(response.status) || !location)
					return toResponse(response, hop > 0);
				url = nextRedirectUrl(location, url, hop);
			}
		} finally {
			// The body is already read (toResponse), so the connections can go.
			session.close();
		}
	}) as EgressFetch;
}
