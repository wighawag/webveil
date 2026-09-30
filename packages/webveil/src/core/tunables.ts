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
// - The serpcast fetch transport's own values are a section,
//   `fetchSerpcast` (`maxIdleSessions` 4, `sessionIdleMs` 10 min,
//   `reuseConnections` on, `timeoutMs` 15 s, `maxBodyBytes` 16 MiB). A section
//   because they apply only when `fetchTransport` is `serpcast`: flat
//   `fetchTimeoutMs` would read as a limit of the plain transport too, which
//   has none. NOT under `serpcast`, because the whole `serpcast` section is
//   the search identity key (identity.ts): a fetch setting must not move the
//   search state partition. Alternative considered: `serpcast.fetch.*`.
// - The serpcast backend's pass-throughs keep serpcast's option names under
//   `serpcast` (as `sessionIdleMs`/`cooldownMs` already did), so serpcast's
//   README documents them; validated here with the same rules serpcast uses
//   (it would throw a RangeError anyway, but only when an instance is built,
//   and the endpoint's two values would only fail each search as a `recipe`
//   engine failure, not loud).
// - `serpcast.sessionIdleMs` must now be positive: serpcast 0.6 refuses 0 at
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
/** Idle serpcast fetch sessions kept per fetch identity. */
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

/** Every `serpcast.*` pass-through that is a plain number, with its rule. */
const SERPCAST_NUMBERS: Record<string, NumberRule> = {
	timeoutMs: {integer: true},
	maxBodyBytes: {integer: true},
	idlePollMs: {},
	maxRequestBodyBytes: {integer: true},
	maxPreflightAgeS: {},
	maxRedirects: {integer: true, zero: true},
	sessionIdleMs: {},
	cooldownMs: {zero: true},
};
const SERPCAST_BOOLEANS = [
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
 * Validate the tuning keys of the `serpcast` section (`section` is
 * `config.serpcast`): its numbers, switches, `decoyRule`, `decoyGuard` in
 * either form, the endpoint's two limits and the `state` subsection.
 */
export function checkSerpcastTunables(section: Record<string, unknown>): void {
	for (const [key, rule] of Object.entries(SERPCAST_NUMBERS))
		checkNumber(`serpcast.${key}`, section[key], rule);
	for (const key of SERPCAST_BOOLEANS)
		checkBoolean(`serpcast.${key}`, section[key]);
	const rule = section.decoyRule;
	if (rule !== undefined) {
		if (!isObject(rule))
			throw new Error('webveil: serpcast.decoyRule must be an object');
		for (const key of Object.keys(rule))
			if (!DECOY_RULE_KEYS.includes(key))
				throw new Error(
					`webveil: serpcast.decoyRule.${key} is not a decoy rule key ` +
						`(${DECOY_RULE_KEYS.join(', ')})`,
				);
		for (const key of DECOY_RULE_KEYS)
			checkNumber(`serpcast.decoyRule.${key}`, rule[key], {integer: true});
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
			'webveil: serpcast.decoyGuard must be a list of engine names or ' +
				'{"include": [...], "exclude": [...]}',
		);
	const browser = section.searchcast;
	if (isObject(browser))
		for (const key of ['timeoutMs', 'maxBodyBytes'])
			checkNumber(`serpcast.searchcast.${key}`, browser[key], {integer: true});
	const state = section.state;
	if (state === undefined) return;
	if (!isObject(state))
		throw new Error('webveil: serpcast.state must be an object');
	checkBoolean('serpcast.state.persist', state.persist);
	for (const key of ['lockStaleMs', 'lockWaitMs'])
		checkNumber(`serpcast.state.${key}`, state[key], {integer: true});
}

/** The serpcast fetch transport's values (`fetchSerpcast`), validated and defaulted. */
export function fetchSerpcastTunables(config: Config) {
	const section: unknown = config.fetchSerpcast ?? {};
	if (!isObject(section))
		throw new Error('webveil: fetchSerpcast must be an object');
	const key = (name: string) => `fetchSerpcast.${name}`;
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
