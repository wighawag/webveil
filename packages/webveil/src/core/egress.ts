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
import {isLoopbackHost} from './security.js';

/** Thrown when a configured egress proxy cannot be built. Never swallowed. */
export class EgressError extends Error {
	constructor(message: string, options?: {cause?: unknown}) {
		super(message, options);
		this.name = 'EgressError';
	}
}

/**
 * Fail-loud guard for the false-confidence combo on the BACKEND hop: a LOCAL
 * backend `baseUrl` (a `unix:` socket OR a loopback-TCP host: 127.0.0.0/8, ::1,
 * localhost) configured with a NON-direct egress (`http`/`socks5`). A local
 * backend is inherently local, so proxying that hop is fake anonymity: webveil
 * would route a pointless local call through the proxy while the backend
 * (SearXNG) crawls the public web from the real IP, OUTSIDE webveil's egress.
 * Refuse it and point at the real fix.
 *
 * SCOPE: this keys on the BACKEND `egress` + `baseUrl` ONLY. It does NOT consult
 * `fetchEgress`: a socks5 FETCH hop with a local+direct BACKEND hop is the blessed
 * local-SearXNG + proxied-web_fetch topology (docs/adr/0003) and is allowed (the
 * fetch target is an arbitrary public URL, not the loopback baseUrl). A REMOTE
 * backend over a proxy stays valid (the guard fires on LOCAL hosts only; a LAN
 * RFC1918 backend over SOCKS is intentionally NOT treated as loopback).
 *
 * This folds in the sibling task `fail-loud-on-proxied-loopback-backend`: the
 * loopback-TCP case lives in THIS single guard (reusing security's loopback
 * classification), not a parallel check.
 */
export function assertEgressAllowsBaseUrl(cfg: Config): void {
	if (cfg.egress.mode === 'direct') return;
	if (isUnixBaseUrl(cfg.baseUrl))
		throw new EgressError(
			`egress ${cfg.egress.mode}: a unix: (local socket) baseUrl cannot be ` +
				`proxied — it is inherently local, so proxying it gives fake ` +
				`anonymity (SearXNG still crawls the web from your real IP). Set ` +
				`egress=direct and proxy the backend itself (SearXNG's ` +
				`outgoing.proxies), or use a remote backend. To proxy web_fetch while ` +
				`keeping the local backend, set fetchEgress (not egress) instead.`,
		);
	let host: string;
	try {
		host = new URL(cfg.baseUrl).hostname;
	} catch {
		return; // a malformed baseUrl is the backend's own problem, not this guard's
	}
	if (isLoopbackHost(host))
		throw new EgressError(
			`egress ${cfg.egress.mode}: a loopback baseUrl (${host}) cannot be ` +
				`proxied (it is local, so proxying it gives fake anonymity: a local ` +
				`SearXNG still crawls the web from your real IP). Set egress=direct ` +
				`and proxy the backend itself (SearXNG's outgoing.proxies), or use a ` +
				`remote backend. To proxy web_fetch while keeping the local backend, ` +
				`set fetchEgress (not egress) instead.`,
		);
}

/**
 * The FETCH-hop egress, resolved from `fetchEgress ?? egress`. Returns a Config
 * whose `.egress` carries the FETCH-hop egress so the existing dispatcher / fetch
 * / SSRF builders (which all key off `cfg.egress`) are reused verbatim for the
 * fetch hop. When `fetchEgress` is unset the FETCH hop inherits the backend
 * `egress`, so single-knob configs behave exactly as before. The carried
 * `baseUrl` is irrelevant to the fetch hop (fetch targets are arbitrary URLs).
 */
export function fetchEgressConfig(cfg: Config): Config {
	if (!cfg.fetchEgress || cfg.fetchEgress === cfg.egress) return cfg;
	return {...cfg, egress: cfg.fetchEgress};
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
