// SSRF guard: the security seam wrapped AROUND the egress-bound `fetch`, so it
// covers BOTH webveil's own GETs AND distilly's rule-rewritten requests (see
// docs/adr/0001: the guard lives inside the egress fetch). Adapts the range
// classification + DNS-resolve approach of leing2021/pi-search's `security.ts`.
//
// THE RELAXATION RULE (load-bearing, recorded in the task's Decisions): the
// guard BLOCKS private/loopback/link-local/etc. addresses on DIRECT egress, and
// RELAXES ENTIRELY under a proxy egress (`http` | `socks5`). Tor/Mullvad
// legitimately reach private-looking addresses (e.g. `10.64.0.1`), AND a local
// DNS lookup for a proxied request would itself be a deanonymizing leak, so
// under a proxy we neither block nor resolve locally; the proxy owns egress.

import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import type {Config} from './config.js';
import type {EgressFetch} from './egress.js';
import {DEFAULT_MAX_REDIRECTS, fetchMaxRedirects} from './tunables.js';

/** Thrown when the SSRF guard refuses a request to a private/blocked address. */
export class SsrfError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SsrfError';
	}
}

/** A proxy egress owns egress + DNS, so the local SSRF guard relaxes for it. */
function egressIsProxy(config: Config): boolean {
	return config.egress.mode === 'http' || config.egress.mode === 'socks5';
}

/**
 * Is this HOST a loopback address (127.0.0.0/8, `::1`) or the `localhost`
 * hostname? This is the NARROW loopback classification the BACKEND-hop egress
 * guard keys on (a local backend behind a proxy is the false-confidence combo).
 * It is deliberately tighter than {@link isPrivateIp}: a remote-but-RFC1918
 * backend (e.g. a LAN SearXNG at 192.168.x.x reached over SOCKS) is a legitimate
 * topology, so the guard must not fire on it, only on a genuinely LOCAL host.
 */
export function isLoopbackHost(host: string): boolean {
	const h = host.replace(/^\[|\]$/g, '').toLowerCase(); // strip IPv6 brackets
	if (h === 'localhost') return true;
	const kind = isIP(h);
	if (kind === 4) return h.split('.')[0] === '127';
	if (kind === 6) return h === '::1' || h === '::ffff:127.0.0.1';
	return false;
}

/**
 * Is this LITERAL IP private / non-public? Covers the ranges that must never be
 * reachable from a direct-egress web fetch:
 *   IPv4: 0.0.0.0/8, 10/8 (RFC1918), 127/8 (loopback), 169.254/16 (link-local,
 *     incl. the 169.254.169.254 cloud metadata endpoint), 172.16/12 (RFC1918),
 *     192.168/16 (RFC1918), 100.64/10 (CGNAT), 192.0.0/24, 192.0.2/24,
 *     198.18/15, 198.51.100/24, 203.0.113/24, 224/4 (multicast), 240/4
 *     (reserved).
 *   IPv6: ::1 (loopback), :: (unspecified), fc00::/7 (ULA), fe80::/10
 *     (link-local), ff00::/8 (multicast), plus IPv4-mapped (::ffff:a.b.c.d,
 *     re-checked as IPv4). Default-deny: anything outside global unicast
 *     (2000::/3) is treated as non-public.
 */
export function isPrivateIp(ip: string): boolean {
	const kind = isIP(ip);
	if (kind === 4) return isPrivateIpv4(ip);
	if (kind === 6) return isPrivateIpv6(ip);
	return false; // not a literal IP; hostname handling resolves it first
}

function isPrivateIpv4(ip: string): boolean {
	const parts = ip.split('.').map((p) => Number(p));
	if (
		parts.length !== 4 ||
		parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
	)
		return true; // malformed → treat as non-public (fail closed)
	const [a, b] = parts as [number, number, number, number];
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
	if (a === 192 && b === 168) return true; // 192.168/16
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
	if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
	if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
	if (a === 198 && b === 51) return true; // 198.51.100/24 TEST-NET-2
	if (a === 203 && b === 0) return true; // 203.0.113/24 TEST-NET-3
	if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
	return false;
}

function isPrivateIpv6(ip: string): boolean {
	const lower = ip.toLowerCase();
	if (lower === '::1' || lower === '::') return true; // loopback / unspecified
	// IPv4-mapped (::ffff:a.b.c.d): re-check the embedded IPv4.
	const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isPrivateIpv4(mapped[1]!);
	const head = lower.split(':')[0] ?? '';
	const first = parseInt(head || '0', 16);
	if (Number.isNaN(first)) return true; // fail closed on anything unparseable
	if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
	if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	// Default-deny: only global unicast 2000::/3 is public.
	return (first & 0xe000) !== 0x2000;
}

/**
 * Assert a URL is safe to fetch under THIS config's egress. Under a proxy egress
 * it always passes (the proxy owns egress + DNS). Under direct egress it rejects
 * a literal private IP and, for a hostname, resolves it locally and rejects if it
 * maps to a private IP (so a name pointing at 127.0.0.1 / metadata is caught).
 */
export async function assertPublicUrl(
	url: string,
	config: Config,
): Promise<void> {
	if (egressIsProxy(config)) return; // proxy owns egress + DNS; relax entirely
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new SsrfError(`webveil SSRF: malformed url ${url}`);
	}
	const host = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
	if (isIP(host)) {
		if (isPrivateIp(host))
			throw new SsrfError(`webveil SSRF: blocked private address ${host}`);
		return;
	}
	// A hostname: resolve it locally (safe on direct egress) and check every
	// address it maps to, so a name pointing at a private IP is also blocked.
	const addrs = await lookup(host, {all: true});
	for (const {address} of addrs)
		if (isPrivateIp(address))
			throw new SsrfError(
				`webveil SSRF: ${host} resolves to private address ${address}`,
			);
}

// ---- Redirect hops -------------------------------------------------------
// Shared by BOTH `web_fetch` transports (the plain guarded fetch below and the
// `fetchTransport: searchcast` adapter in fetch-transport.ts), so a redirect
// target gets the same gate on either: http(s) only, SSRF-checked, at most
// `fetchMaxRedirects` hops (default MAX_REDIRECTS, tunables.ts).

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** At most this many redirects are followed by default (the WHATWG fetch limit). */
export const MAX_REDIRECTS = DEFAULT_MAX_REDIRECTS;

/** Is this status a redirect webveil follows (301, 302, 303, 307, 308)? */
export function isRedirectStatus(status: number): boolean {
	return REDIRECT_STATUSES.has(status);
}

/**
 * The gate EVERY hop passes before it is sent: refuse a non-http(s) url, then
 * run the SSRF check (`assert`, {@link assertPublicUrl} unless a test seams it).
 */
export async function assertFetchableHop(
	url: string,
	config: Config,
	assert: (url: string, config: Config) => Promise<void> = assertPublicUrl,
): Promise<void> {
	const protocol = URL.canParse(url) ? new URL(url).protocol : '';
	if (protocol !== 'http:' && protocol !== 'https:')
		throw new Error(`webveil: refusing to fetch non-http(s) url ${url}`);
	await assert(url, config);
}

/**
 * The next url of a redirect (its `Location` resolved against the current url),
 * or an error once `hop` (0 for the first response) reaches `max`.
 */
export function nextRedirectUrl(
	location: string,
	url: string,
	hop: number,
	max = MAX_REDIRECTS,
): string {
	if (hop >= max)
		throw new Error(
			`webveil: too many redirects (more than ${max}) fetching ${url}`,
		);
	return new URL(location, url).href;
}

/** Test seam: how a hop is SSRF-checked (defaults to {@link assertPublicUrl}). */
export interface GuardDeps {
	assertPublicUrl?: (url: string, config: Config) => Promise<void>;
}

/** Headers dropped when a redirect crosses origins (as undici's fetch does). */
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];
/** Headers dropped when a redirect turns the request into a body-less GET. */
const BODY_HEADERS = [
	'content-type',
	'content-length',
	'content-encoding',
	'content-language',
	'content-location',
];

/**
 * Wrap an egress-bound `fetch` with the SSRF guard. The returned fetch checks
 * EVERY request it sends (so it covers distilly's rule-rewritten requests too,
 * not only webveil's own GET) before delegating to the underlying egress fetch.
 * This is what `core.fetch()` injects into distilly. See docs/adr/0001.
 *
 * Redirects (task plain-fetch-ssrf-check-every-redirect). On DIRECT egress the
 * guard follows redirects ITSELF: it calls the wrapped fetch with
 * `redirect: 'manual'` and runs {@link assertFetchableHop} on every target, so a
 * public page redirecting to 127.0.0.1 or cloud metadata is refused before the
 * target is requested. Recorded decisions:
 * - The caller's `redirect` mode is honoured: `follow` (distilly's, and the
 *   default) as above; `manual` returns the redirect response unchanged (only
 *   the first url is checked, nothing else is sent); `error` rejects with a
 *   TypeError on any redirect status, as fetch does.
 * - Method/body per the fetch spec: 303 (unless GET/HEAD), and 301/302 on POST,
 *   become a body-less GET (body headers dropped); 307/308 re-send the same
 *   method and `init.body`. webveil only sends GET today, so a streamed or
 *   `Request`-carried body is NOT re-sent on 307/308 (kept simple on purpose).
 * - Cross-origin hops drop `authorization`, `proxy-authorization` and `cookie`,
 *   as undici's own redirect following does, so legitimate chains behave as
 *   before.
 * - A followed response reports the last hop as `url` and `redirected: true`
 *   (distilly resolves relative links against `url`). A response with no
 *   redirect is returned untouched.
 * - Under a PROXY egress (`http` | `socks5`) the guard relaxes entirely, as for
 *   the first url (see THE RELAXATION RULE above): the request is delegated
 *   unchanged and the egress fetch (undici) follows redirects natively. No hop
 *   is checked, no DNS lookup happens locally. Alternative considered: follow
 *   manually under a proxy too (one code path), rejected because it would
 *   change proxied behaviour for no security gain (every check is a no-op).
 * - `fetchMaxRedirects` (task webveil-installs-and-tunables) caps the hops
 *   followed here. undici's own following has a fixed limit of 20, so under a
 *   PROXY egress with `fetchMaxRedirects` SET the guard follows the redirects
 *   itself too (the SSRF check is still a no-op there, only the http(s) rule
 *   applies); unset, the proxied path stays exactly as above. Alternative
 *   considered: documenting the key as direct-egress only, rejected because a
 *   setting that silently does nothing on one egress is the kind of
 *   unswitchable behaviour the key exists to remove.
 */
export function guardEgressFetch(
	fetch: EgressFetch,
	config: Config,
	deps: GuardDeps = {},
): EgressFetch {
	const assert = deps.assertPublicUrl ?? assertPublicUrl;
	const max = fetchMaxRedirects(config); // validated before any request
	const delegate =
		egressIsProxy(config) && config.fetchMaxRedirects === undefined;
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (delegate) return fetch(input as never, init as never);
		const request =
			typeof input === 'string' || input instanceof URL ? undefined : input;
		let url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const mode = init?.redirect ?? request?.redirect ?? 'follow';
		let method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
		const headers = new Headers(init?.headers ?? request?.headers);
		let body = init?.body ?? null;
		const signal = init?.signal ?? request?.signal;
		for (let hop = 0; ; hop++) {
			await assertFetchableHop(url, config, assert);
			const response: Response =
				hop === 0
					? await fetch(input as never, {...init, redirect: 'manual'} as never)
					: await fetch(url, {
							...init,
							method,
							headers,
							body,
							...(signal && {signal}),
							redirect: 'manual',
						});
			if (mode === 'manual' || !isRedirectStatus(response.status))
				return followed(response, url, hop);
			if (mode === 'error') {
				await response.body?.cancel().catch(() => {});
				throw new TypeError(
					`webveil: redirect refused (redirect mode 'error') fetching ${url}`,
				);
			}
			const location = response.headers.get('location');
			if (!location) return followed(response, url, hop);
			await response.body?.cancel().catch(() => {});
			const next = nextRedirectUrl(location, url, hop, max);
			const status = response.status;
			if (
				(status === 303 && method !== 'GET' && method !== 'HEAD') ||
				((status === 301 || status === 302) && method === 'POST')
			) {
				method = 'GET';
				body = null;
				for (const name of BODY_HEADERS) headers.delete(name);
			}
			if (new URL(next).origin !== new URL(url).origin)
				for (const name of CREDENTIAL_HEADERS) headers.delete(name);
			url = next;
		}
	}) as EgressFetch;
}

/** A response reached after `hop` redirects reports the last url, redirected. */
function followed(response: Response, url: string, hop: number): Response {
	if (hop === 0) return response;
	Object.defineProperty(response, 'url', {value: url});
	Object.defineProperty(response, 'redirected', {value: true});
	return response;
}
