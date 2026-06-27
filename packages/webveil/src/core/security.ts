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

/**
 * Wrap an egress-bound `fetch` with the SSRF guard. The returned fetch checks
 * EVERY request URL (so it covers distilly's rule-rewritten requests too, not
 * only webveil's own GET) before delegating to the underlying egress fetch.
 * This is what `core.fetch()` injects into distilly. See docs/adr/0001.
 */
export function guardEgressFetch(
	fetch: EgressFetch,
	config: Config,
): EgressFetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.href
					: input.url;
		await assertPublicUrl(url, config);
		return fetch(input as never, init as never);
	}) as EgressFetch;
}
