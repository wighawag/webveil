// egress seam — how outbound HTTP leaves the machine. Yields TWO artifacts off
// the SAME undici dispatcher: the proxied `http` helper (see http.ts, handed to
// backends) and an egress-bound WHATWG `fetch` (injected into distilly/fetch).
//
// CRITICAL anonymity invariant (docs/adr/0001): egress is fail-loud. A
// configured proxy that cannot be built MUST throw — it must NEVER silently
// fall back to un-proxied (direct) transport.

import {Agent, type Dispatcher, ProxyAgent, fetch as undiciFetch} from 'undici';
import {socksDispatcher} from 'fetch-socks';
import type {Config, Egress} from './config.js';
import {isUnixBaseUrl} from './baseurl.js';

/** Thrown when a configured egress proxy cannot be built. Never swallowed. */
export class EgressError extends Error {
	constructor(message: string, options?: {cause?: unknown}) {
		super(message, options);
		this.name = 'EgressError';
	}
}

/**
 * Fail-loud guard for the false-confidence combo: a `unix:` (local-socket)
 * backend `baseUrl` configured with a NON-direct egress (`http`/`socks5`). A
 * Unix socket is inherently local, so proxying that hop is the same fake-
 * anonymity footgun as proxying a loopback TCP baseUrl: webveil would route a
 * pointless local call through the proxy while the backend (SearXNG) crawls the
 * public web from the real IP, OUTSIDE webveil's egress. Refuse it and point at
 * the real fix.
 *
 * OVERLAP SEAM (recorded): this is the loopback false-confidence family. The
 * sibling task `fail-loud-on-proxied-loopback-backend` adds the broader guard
 * for loopback TCP baseUrls (127.0.0.0/8, ::1, localhost). When it lands, fold
 * THIS `unix:`-is-loopback-equivalent case into that single guard instead of
 * keeping a parallel check here.
 */
export function assertEgressAllowsBaseUrl(cfg: Config): void {
	if (cfg.egress.mode === 'direct') return;
	if (isUnixBaseUrl(cfg.baseUrl))
		throw new EgressError(
			`egress ${cfg.egress.mode}: a unix: (local socket) baseUrl cannot be ` +
				`proxied — it is inherently local, so proxying it gives fake ` +
				`anonymity (SearXNG still crawls the web from your real IP). Set ` +
				`egress=direct and proxy the backend itself (SearXNG's ` +
				`outgoing.proxies), or use a remote backend.`,
		);
}

function socksFromUrl(raw: string): Dispatcher {
	const url = new URL(raw); // throws on a malformed proxy URL → fail loud
	const protocol = url.protocol.replace(':', '');
	if (protocol !== 'socks5' && protocol !== 'socks' && protocol !== 'socks5h')
		throw new EgressError(
			`egress socks5: expected a socks5:// proxy url, got ${raw}`,
		);
	const port = Number(url.port);
	if (!url.hostname || !Number.isInteger(port) || port <= 0)
		throw new EgressError(`egress socks5: invalid host/port in ${raw}`);
	return socksDispatcher({
		type: 5,
		host: url.hostname,
		port,
		userId: url.username || undefined,
		password: url.password || undefined,
	});
}

/**
 * Build the undici Dispatcher for the config's egress mode:
 *   - direct → undefined (undici uses its default, un-proxied transport)
 *   - http   → ProxyAgent
 *   - socks5 → socks dispatcher (undici Agent over a socks connector)
 *
 * Throws (fail loud) if a configured http/socks5 proxy cannot be built. It
 * NEVER returns `undefined` (direct) as a fallback for a broken proxy.
 */
export function buildDispatcher(cfg: Config): Dispatcher | undefined {
	const egress: Egress = cfg.egress;
	switch (egress.mode) {
		case 'direct':
			return undefined;
		case 'http':
			try {
				if (!egress.url) throw new Error('missing proxy url');
				return new ProxyAgent(egress.url);
			} catch (cause) {
				throw new EgressError(
					`egress http: could not build proxy for ${egress.url}`,
					{cause},
				);
			}
		case 'socks5':
			try {
				if (!egress.url) throw new Error('missing proxy url');
				return socksFromUrl(egress.url);
			} catch (cause) {
				if (cause instanceof EgressError) throw cause;
				throw new EgressError(
					`egress socks5: could not build proxy for ${egress.url}`,
					{cause},
				);
			}
		default: {
			const exhaustive: never = egress;
			throw new EgressError(
				`egress: unknown mode ${JSON.stringify(exhaustive)}`,
			);
		}
	}
}

/** A WHATWG-compatible fetch bound to a specific egress dispatcher. */
export type EgressFetch = typeof globalThis.fetch;

/**
 * Build an egress-bound WHATWG `fetch`: undici's `fetch` closed over the
 * dispatcher from buildDispatcher(cfg). This is the `fetch` injected into
 * distilly/fetch so distilly never has egress of its own. Same fail-loud
 * guarantee: a broken proxy throws HERE (before any I/O), never goes un-proxied.
 */
export function createEgressFetch(cfg: Config): EgressFetch {
	const dispatcher = buildDispatcher(cfg);
	return ((input: RequestInfo | URL, init?: RequestInit) =>
		undiciFetch(
			input as never,
			{
				...((init ?? {}) as Record<string, unknown>),
				dispatcher,
			} as never,
		)) as EgressFetch;
}

export type {Dispatcher};
export {Agent, ProxyAgent};
