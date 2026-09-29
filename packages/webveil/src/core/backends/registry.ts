// backend registry — a tiny `name -> Backend` dispatcher (concept trimmed from
// pi-search-hub's registry). Each backend registers a factory keyed by its config
// `backend` name; `getBackend` resolves the name to a constructed Backend (handed
// the resolved config so it knows its instance baseUrl / apiKey) and fails clearly
// on an unknown name. Later backend tasks (tavily-compat, custom) append their own
// registrations to FACTORIES below.

import type {Config} from '../config.js';
import type {Backend} from './types.js';
import {createSearxngBackend} from './searxng.js';
import {createTavilyCompatBackend} from './tavily-compat.js';
import {createCustomBackend} from './custom.js';
import {closeSerpcastInstances, createSerpcastBackend} from './serpcast.js';
import {closeFetchTransports} from '../fetch-transport.js';

/** Builds a Backend from the resolved config (knows its baseUrl / apiKey). */
export type BackendFactory = (config: Config) => Backend;

/** name -> factory. New backends add an entry here. */
const FACTORIES: Record<string, BackendFactory> = {
	searxng: createSearxngBackend,
	'tavily-compat': createTavilyCompatBackend,
	custom: createCustomBackend,
	serpcast: createSerpcastBackend,
};

/** The backend names the registry can resolve. */
export function backendNames(): string[] {
	return Object.keys(FACTORIES);
}

/**
 * Resolve a backend name to a constructed Backend. Throws clearly on an unknown
 * name (listing the known ones) so a misconfigured `backend` fails loud, never
 * silently no-ops.
 */
export function getBackend(name: string, config: Config): Backend {
	const factory = FACTORIES[name];
	if (!factory)
		throw new Error(
			`webveil: unknown backend '${name}' (known: ${backendNames().join(', ')})`,
		);
	return factory(config);
}

/**
 * Release what backends keep across searches (the cached serpcast instances,
 * and the cached serpcast transports of `fetchTransport: serpcast`).
 * Frontends call it at PROCESS level (never per command: under MCP that would
 * defeat the cache): after a one-shot CLI command, at MCP server or pi shutdown.
 */
export async function closeBackends(): Promise<void> {
	await Promise.all([closeSerpcastInstances(), closeFetchTransports()]);
}
