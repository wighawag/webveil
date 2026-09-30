// tunables: every number and switch a user may need to change, validated where
// it is used (fail loud, naming the config key) and defaulted to the value
// webveil had before it became a setting, so nothing changes unless it is set.
// The keys and their env forms live in config.ts; this module owns the rules
// and the defaults.
//
// Recorded decisions (task webveil-installs-and-tunables; owner decision
// 2026-09-30: no magic numbers or unswitchable behaviours a user might need):
// - Top-level keys, not a new `tuning` section: `maxResults` (the default
//   search cut, 10) and `httpTimeoutMs` (the backend http helper's timeout,
//   30 s) govern every backend; `fetchMaxRedirects` (20) governs BOTH
//   `web_fetch` transports, so it joins the flat `fetch*` family
//   (`fetchEgress`, `fetchSize`, `fetchTransport`).
// - The searchcast fetch transport's own values are a section,
//   `fetchSearchcast` (`maxIdleSessions` 4, `sessionIdleMs` 10 min,
//   `reuseConnections` on, `timeoutMs` 15 s, `maxBodyBytes` 16 MiB). A section
//   because they apply only when `fetchTransport` is `searchcast`: flat
//   `fetchTimeoutMs` would read as a limit of the plain transport too, which
//   has none. NOT under `searchcast`, because the whole `searchcast` section is
//   the search identity key (identity.ts): a fetch setting must not move the
//   search state partition. Alternative considered: `searchcast.fetch.*`.
// - The searchcast backend's pass-throughs keep searchcast's option names under
//   `searchcast` (as `sessionIdleMs`/`cooldownMs` already did), so searchcast's
//   README documents them; validated here with the same rules searchcast uses
//   (it would throw a RangeError anyway, but only when an instance is built,
//   and the endpoint's two values would only fail each search as a `recipe`
//   engine failure, not loud).
// - `searchcast.sessionIdleMs` must now be positive: serpcast 0.6 refuses 0 at
//   instance creation, so webveil's old `>= 0` check let a value through that
//   could never work.

import type {Config} from './config.js';

/** A number rule: whole numbers only, and whether 0 ("off"/"none") is valid. */
export interface NumberRule {
	integer?: boolean;
	zero?: boolean;
}

/** `value` when undefined or valid for `key`, else a loud error naming `key`. */
export function checkNumber(
	key: string,
	value: unknown,
	rule: NumberRule = {},
): number | undefined {
	if (value === undefined) return undefined;
	const ok =
		typeof value === 'number' &&
		Number.isFinite(value) &&
		(rule.zero ? value >= 0 : value > 0) &&
		(!rule.integer || Number.isInteger(value));
	if (ok) return value;
	const kind = rule.integer ? 'integer' : 'number';
	const range = rule.zero
		? `${kind === 'integer' ? 'an' : 'a'} ${kind} >= 0`
		: `a positive ${kind}`;
	throw new Error(`webveil: ${key} must be ${range} (got ${show(value)})`);
}

/** `value` when undefined or a boolean, else a loud error naming `key`. */
export function checkBoolean(key: string, value: unknown): boolean | undefined {
	if (value === undefined || typeof value === 'boolean') return value;
	throw new Error(`webveil: ${key} must be true or false (got ${show(value)})`);
}

const show = (value: unknown) =>
	typeof value === 'string' ? `'${value}'` : String(JSON.stringify(value));

export const DEFAULT_MAX_RESULTS = 10;
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
/** At most this many redirects are followed (the WHATWG fetch limit). */
export const DEFAULT_MAX_REDIRECTS = 20;
/** Idle searchcast fetch sessions kept per fetch identity. */
export const DEFAULT_MAX_IDLE_SESSIONS = 4;

/** The backend http helper's timeout (`httpTimeoutMs`). */
export function httpTimeoutMs(config: Config): number {
	return (
		checkNumber('httpTimeoutMs', config.httpTimeoutMs, {integer: true}) ??
		DEFAULT_HTTP_TIMEOUT_MS
	);
}

/** The search-wide values: the default result cut and the http helper timeout. */
export function searchTunables(config: Config) {
	return {
		maxResults:
			checkNumber('maxResults', config.maxResults, {integer: true}) ??
			DEFAULT_MAX_RESULTS,
		httpTimeoutMs: httpTimeoutMs(config),
	};
}

/** `fetchMaxRedirects` (both `web_fetch` transports). 0 follows none. */
export function fetchMaxRedirects(config: Config): number {
	return (
		checkNumber('fetchMaxRedirects', config.fetchMaxRedirects, {
			integer: true,
			zero: true,
		}) ?? DEFAULT_MAX_REDIRECTS
	);
}

/** Every `searchcast.*` pass-through that is a plain number, with its rule. */
const SEARCHCAST_NUMBERS: Record<string, NumberRule> = {
	timeoutMs: {integer: true},
	maxBodyBytes: {integer: true},
	idlePollMs: {},
	maxRequestBodyBytes: {integer: true},
	maxPreflightAgeS: {},
	maxRedirects: {integer: true, zero: true},
	sessionIdleMs: {},
	cooldownMs: {zero: true},
};
const SEARCHCAST_BOOLEANS = [
	'reuseConnections',
	'keepSessions',
	'preflightCache',
];
const DECOY_RULE_KEYS = ['top', 'maxRelevant', 'prefix'];

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isNames = (v: unknown) =>
	Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Validate the tuning keys of the `searchcast` section (`section` is
 * `config.searchcast`): its numbers, switches, `decoyRule`, `decoyGuard` in
 * either form, the endpoint's two limits and the `state` subsection.
 */
export function checkSearchcastTunables(
	section: Record<string, unknown>,
): void {
	for (const [key, rule] of Object.entries(SEARCHCAST_NUMBERS))
		checkNumber(`searchcast.${key}`, section[key], rule);
	for (const key of SEARCHCAST_BOOLEANS)
		checkBoolean(`searchcast.${key}`, section[key]);
	const rule = section.decoyRule;
	if (rule !== undefined) {
		if (!isObject(rule))
			throw new Error('webveil: searchcast.decoyRule must be an object');
		for (const key of Object.keys(rule))
			if (!DECOY_RULE_KEYS.includes(key))
				throw new Error(
					`webveil: searchcast.decoyRule.${key} is not a decoy rule key ` +
						`(${DECOY_RULE_KEYS.join(', ')})`,
				);
		for (const key of DECOY_RULE_KEYS)
			checkNumber(`searchcast.decoyRule.${key}`, rule[key], {integer: true});
	}
	const guard = section.decoyGuard;
	const guardOk =
		guard === undefined ||
		isNames(guard) ||
		(isObject(guard) &&
			Object.keys(guard).every((k) => k === 'include' || k === 'exclude') &&
			(guard.include === undefined || isNames(guard.include)) &&
			(guard.exclude === undefined || isNames(guard.exclude)));
	if (!guardOk)
		throw new Error(
			'webveil: searchcast.decoyGuard must be a list of engine names or ' +
				'{"include": [...], "exclude": [...]}',
		);
	const browser = section.browser;
	if (isObject(browser))
		for (const key of ['timeoutMs', 'maxBodyBytes'])
			checkNumber(`searchcast.browser.${key}`, browser[key], {integer: true});
	const state = section.state;
	if (state === undefined) return;
	if (!isObject(state))
		throw new Error('webveil: searchcast.state must be an object');
	checkBoolean('searchcast.state.persist', state.persist);
	for (const key of ['lockStaleMs', 'lockWaitMs'])
		checkNumber(`searchcast.state.${key}`, state[key], {integer: true});
}

/** The searchcast fetch transport's values (`fetchSearchcast`), validated and defaulted. */
export function fetchSearchcastTunables(config: Config) {
	const section: unknown = config.fetchSearchcast ?? {};
	if (!isObject(section))
		throw new Error('webveil: fetchSearchcast must be an object');
	const key = (name: string) => `fetchSearchcast.${name}`;
	return {
		maxIdleSessions:
			checkNumber(key('maxIdleSessions'), section.maxIdleSessions, {
				integer: true,
				zero: true,
			}) ?? DEFAULT_MAX_IDLE_SESSIONS,
		sessionIdleMs: checkNumber(key('sessionIdleMs'), section.sessionIdleMs, {
			integer: true,
		}),
		reuseConnections: checkBoolean(
			key('reuseConnections'),
			section.reuseConnections,
		),
		timeoutMs: checkNumber(key('timeoutMs'), section.timeoutMs, {
			integer: true,
		}),
		maxBodyBytes: checkNumber(key('maxBodyBytes'), section.maxBodyBytes, {
			integer: true,
		}),
	};
}
