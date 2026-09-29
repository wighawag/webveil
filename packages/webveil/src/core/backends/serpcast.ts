// serpcast backend: keyless search with no SearXNG. serpcast (policy-free, its
// ADR 0002) runs recipes over libcurl-impersonate; webveil injects the policy
// (docs/adr/0004): the backend-hop `egress` is serpcast's proxy, strict
// impersonation is always on, the libcurl path and code recipe paths are
// executable settings.
// serpcast owns its own I/O, so the handed `http` helper is unused (as custom).
//
// Recorded decisions (task serpcast-backend-basic; config keys: config.ts,
// identity key: identity.ts):
// - No `engines` is an error, not "every loaded recipe": the order decides which
//   engines see traffic, so it must be chosen. An unknown name is an error too.
// - An `empty` answer after failures returns [] (serpcast's genuine "no
//   results"); only `exhausted` is an error. Failed engines before an answer
//   annotate the results as `unresponsiveEngines`, as for searxng.
//
// Recorded decisions (task serpcast-code-recipes-trusted; key and env form:
// config.ts):
// - `serpcast.codeRecipes` joins EXECUTABLE_KEYS, so the one trust check
//   (`assertTrusted`, in `settings`) refuses a project-set path BEFORE any
//   module is imported; paths are resolved absolute first (serpcast's
//   `loadCodeRecipe` would resolve a relative one against the cwd).
// - Code recipes and declarative recipes share one name space: a name used
//   twice (across both kinds, or within either) is an error, never a silent
//   override, as `loadRecipes` does for duplicate JSON recipes.
// - Every listed module is imported on each search (Node's module cache makes
//   repeats cheap), since a module's engine name is only known once imported.

import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {
	createSerpcast as realCreateSerpcast,
	loadCodeRecipe,
	SerpcastError,
} from 'serpcast';
import type {Engine, Serpcast, SerpcastOptions} from 'serpcast';
import {loadRecipes} from 'serpcast-recipe/node';
import type {Config, Egress, SerpcastConfig} from '../config.js';
import {EgressError} from '../egress.js';
import {identityKey} from '../identity.js';
import {assertTrusted, resolveExecutablePath, sourceOf} from '../trust.js';
import type {Backend, SearchResult} from './types.js';

/** Test seam: how an instance is created (default: serpcast's). */
export interface SerpcastDeps {
	createSerpcast?: (options: SerpcastOptions) => Serpcast;
}

const EXECUTABLE_KEYS = ['serpcast.libcurlPath', 'serpcast.codeRecipes'];
const SOCKS = ['socks5', 'socks', 'socks5h'];
const instances = new Map<string, Serpcast>();

/** The proxy URL for serpcast: SOCKS always `socks5h` (DNS at the proxy). */
export function serpcastProxy(egress: Egress): string | undefined {
	if (egress.mode === 'direct') return undefined;
	const url = egress.url ?? '';
	const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
	const allowed = egress.mode === 'http' ? ['http', 'https'] : SOCKS;
	if (!url.includes('://') || !allowed.includes(scheme) || !URL.canParse(url))
		throw new EgressError(`egress ${egress.mode}: invalid proxy url '${url}'`);
	return egress.mode === 'http' ? url : `socks5h${url.slice(scheme.length)}`;
}

/** Resolve a path setting where it was set (never against the cwd). */
function resolvePath(config: Config, key: string, value: string): string {
	return resolveExecutablePath(value, sourceOf(config, `serpcast.${key}`));
}

const isList = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((x) => typeof x === 'string');
const num = (v: unknown) => (v === undefined ? undefined : Number(v));

/** The section validated, its paths resolved (trust-checked first). */
function settings(config: Config): SerpcastConfig {
	assertTrusted(config, EXECUTABLE_KEYS);
	const s: SerpcastConfig = {...config.serpcast};
	if (!isList(s.engines) || s.engines.length === 0)
		throw new Error('serpcast: set serpcast.engines (engine names, in order)');
	for (const key of ['recipes', 'codeRecipes'] as const)
		if (s[key] !== undefined && !isList(s[key]))
			throw new Error(`serpcast: serpcast.${key} must be a list of paths`);
	for (const key of ['sessionIdleMs', 'cooldownMs'] as const)
		if (s[key] !== undefined && !(Number(s[key]) >= 0))
			throw new Error(`serpcast: serpcast.${key} must be a number >= 0`);
	if (s.recipes)
		s.recipes = s.recipes.map((p) => resolvePath(config, 'recipes', p));
	if (s.codeRecipes)
		s.codeRecipes = s.codeRecipes.map((p) =>
			resolvePath(config, 'codeRecipes', p),
		);
	if (s.libcurlPath)
		s.libcurlPath = resolvePath(config, 'libcurlPath', s.libcurlPath);
	return s;
}

/** Every recipe by name: declarative, then code (imports, i.e. RUNS, each module). */
async function loadEngines(s: SerpcastConfig): Promise<Map<string, Engine>> {
	const engines = new Map<string, Engine>(loadRecipes(s.recipes ?? []));
	const files = (s.codeRecipes ?? []).flatMap((p) =>
		statSync(p).isDirectory()
			? readdirSync(p)
					.sort()
					.filter((f) => /\.m?js$/.test(f))
					.map((f) => join(p, f))
			: [p],
	);
	for (const file of files) {
		const recipe = await loadCodeRecipe(file);
		if (engines.has(recipe.name))
			throw new Error(
				`serpcast: ${file}: duplicate recipe name '${recipe.name}'`,
			);
		engines.set(recipe.name, recipe);
	}
	return engines;
}

/** This backend's identity key (identity.ts): egress + resolved section. */
export function serpcastIdentityKey(
	config: Config,
	resolved = settings(config),
) {
	return identityKey(config.egress, resolved);
}

/** Close every cached instance (process shutdown; see registry closeBackends). */
export async function closeSerpcastInstances(): Promise<void> {
	const all = [...instances.values()];
	instances.clear();
	await Promise.allSettled(all.map((instance) => instance.close()));
}

function failure(error: unknown): Error {
	if (!(error instanceof SerpcastError)) return error as Error;
	if (error.kind === 'impersonation')
		return new Error(
			`serpcast: browser impersonation is not active (${error.message}). ` +
				'Fix: run `npx serpcast install-libcurl`, or set serpcast.libcurlPath ' +
				'in the global config (or WEBVEIL_SERPCAST_LIBCURL_PATH) to a ' +
				'libcurl-impersonate library.',
			{cause: error},
		);
	if (error.kind !== 'exhausted') return error;
	const each = (error.failures ?? []).map(
		(f) => `${f.engine} (${f.error.kind}: ${f.error.message})`,
	);
	return new Error(`serpcast: every engine failed: ${each.join('; ')}`, {
		cause: error,
	});
}

/** Build the backend; everything (trust, recipes, instance) happens per search. */
export function createSerpcastBackend(
	config: Config,
	deps: SerpcastDeps = {},
): Backend {
	return {
		async search(query, _http, options = {}): Promise<SearchResult[]> {
			const s = settings(config);
			const recipes = await loadEngines(s);
			const engines = s.engines!.map((name) => {
				const recipe = recipes.get(name);
				if (recipe) return recipe;
				throw new Error(
					`serpcast: unknown engine '${name}' (loaded recipes: ` +
						`${[...recipes.keys()].join(', ') || 'none'})`,
				);
			});
			const key = serpcastIdentityKey(config, s);
			let instance = instances.get(key);
			if (!instance) {
				instance = (deps.createSerpcast ?? realCreateSerpcast)({
					proxy: serpcastProxy(config.egress),
					strict: true,
					libcurlPath: s.libcurlPath,
					sessionIdleMs: num(s.sessionIdleMs),
					cooldownMs: num(s.cooldownMs),
				});
				instances.set(key, instance);
			}
			const answer = await instance
				.search(query, {engines, signal: options.signal})
				.catch((error: unknown) => Promise.reject(failure(error)));
			const failed = answer.failures.map((f) => f.engine);
			return answer.results.map(({title, url, snippet}) => ({
				title,
				url,
				...(snippet ? {snippet} : {}),
				...(failed.length > 0 ? {unresponsiveEngines: failed} : {}),
			}));
		},
	};
}
