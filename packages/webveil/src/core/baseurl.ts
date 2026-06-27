// baseUrl transport parsing — the small, transport-AWARE helper that classifies
// a resolved `baseUrl` into either a normal TCP HTTP base or a Unix-domain-socket
// form, and (for the socket form) rewrites it into a synthetic `http://localhost`
// base that the transport-UNAWARE backends can build their request URL on top of.
//
// WHY THIS LIVES HERE (and not in egress.ts): the egress dispatcher
// (`buildDispatcher`) is built ONCE from config and SHARED by both the backend
// hop (search.ts) AND the arbitrary-public-URL fetch (fetch.ts). Binding a socket
// `Agent` into that shared dispatcher would route every `web_fetch` into the
// SearXNG socket. So the socket transport is scoped to the BACKEND `baseUrl` hop
// only: search.ts asks this helper to translate the baseUrl, gets back a real
// `http://localhost…` base (which the searxng backend's `new URL('search', base)`
// still works on, unchanged) plus the per-hop socket `Agent`, and leaves the
// fetch/SSRF egress path untouched.
//
// GRAMMAR (recorded decision, see the task's done record):
//   unix:<socketPath>[:<httpPath>]
//     - `<socketPath>`: the absolute path to the uWSGI Unix domain socket
//       (e.g. /usr/local/searxng/run/socket). Must not contain a `:` (the parse
//       splits on the FIRST `:` after the `unix:` scheme; conventional socket
//       paths never contain a colon).
//     - `<httpPath>`: OPTIONAL base path the SearXNG app is mounted under,
//       defaulting to `/`. It is the SAME thing the TCP `baseUrl` encodes as its
//       path: the backend appends `search` to it (`new URL('search', base + '/')`),
//       so the install default is just `unix:/usr/local/searxng/run/socket` (the
//       backend then requests `/search`). A non-root mount is `…/socket:/searxng`.
//   A raw `unix:…` string is NOT a valid base for `new URL('search', …)`, so this
//   translation MUST run BEFORE the backend builds its URL.

import {Agent, type Dispatcher} from 'undici';

/** The `unix:` scheme prefix this helper recognizes on a `baseUrl`. */
const UNIX_PREFIX = 'unix:';

/** A parsed Unix-socket baseUrl: the socket file path + the app's base path. */
export interface UnixBaseUrl {
	socketPath: string;
	/** The app's base path (mount point); the backend appends `search` to it. */
	httpPath: string;
}

/** Is this resolved `baseUrl` a Unix-domain-socket form (`unix:…`)? */
export function isUnixBaseUrl(baseUrl: string): boolean {
	return baseUrl.startsWith(UNIX_PREFIX);
}

/**
 * Parse a `unix:<socketPath>[:<httpPath>]` baseUrl into `{socketPath, httpPath}`.
 * Splits on the FIRST `:` after the `unix:` scheme (socket paths conventionally
 * carry no colon); an absent/empty `<httpPath>` defaults to `/`.
 *
 * Throws if the socket path is empty (there is nothing to connect to).
 */
export function parseUnixBaseUrl(baseUrl: string): UnixBaseUrl {
	const rest = baseUrl.slice(UNIX_PREFIX.length);
	const sep = rest.indexOf(':');
	const socketPath = sep === -1 ? rest : rest.slice(0, sep);
	const rawHttpPath = sep === -1 ? '' : rest.slice(sep + 1);
	if (!socketPath)
		throw new Error(
			`webveil: malformed unix baseUrl ${JSON.stringify(baseUrl)} — ` +
				`expected unix:<socketPath>[:<httpPath>] with a non-empty socket path`,
		);
	const httpPath = rawHttpPath
		? rawHttpPath.startsWith('/')
			? rawHttpPath
			: '/' + rawHttpPath
		: '/';
	return {socketPath, httpPath};
}

/**
 * The result of resolving a `baseUrl` for the BACKEND hop: the (possibly
 * rewritten) HTTP base the backend builds its request URL on, plus an OPTIONAL
 * undici `Dispatcher` to carry that hop. For a normal TCP baseUrl the dispatcher
 * is `undefined` (the caller uses the config-wide egress dispatcher); for a
 * `unix:` baseUrl it is a socket-bound `Agent` and the base is a synthetic
 * `http://localhost<httpPath>`.
 */
export interface BackendTransport {
	baseUrl: string;
	dispatcher?: Dispatcher;
}

/**
 * Resolve a `baseUrl` into a backend-hop transport. For a `unix:` baseUrl this
 * builds a socket-bound `Agent({connect:{socketPath}})` and a synthetic
 * `http://localhost<httpPath>` base (the URL host is irrelevant to routing — the
 * socket decides — and only becomes the `Host` header). For any other baseUrl it
 * returns the baseUrl unchanged with NO dispatcher (the caller keeps using the
 * shared config-wide egress dispatcher).
 *
 * NOTE: this is the BACKEND-hop transport only. It is never bound into the
 * shared egress dispatcher, so `web_fetch`/SSRF egress is unaffected.
 */
export function resolveBackendTransport(baseUrl: string): BackendTransport {
	if (!isUnixBaseUrl(baseUrl)) return {baseUrl};
	const {socketPath, httpPath} = parseUnixBaseUrl(baseUrl);
	const dispatcher = new Agent({connect: {socketPath}});
	return {
		baseUrl: `http://localhost${httpPath === '/' ? '' : httpPath}`,
		dispatcher,
	};
}
