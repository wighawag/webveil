// config seam — per-folder resolution. Precedence (highest wins):
//   env > nearest webveil.json (walking up from cwd) > global
//   $XDG_CONFIG_HOME/webveil/config.json (~/.config/webveil/config.json) >
//   defaults.
// "Per folder = per account/egress." Each layer is a partial; later (lower)
// layers fill gaps the higher layers leave. The project file is a
// frontend-neutral `webveil.json` (no `.pi/`): both the pi-agnostic CLI and the
// pi extension resolve the same name, so a project is configured the same way
// regardless of which frontend reads it. See docs/adr/0002.

import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, parse} from 'node:path';

/** How outbound HTTP leaves the machine. See egress.ts. */
export type Egress =
	| {mode: 'direct'}
	| {mode: 'http'; url: string}
	| {mode: 'socks5'; url: string};

/** Page-size budget preset for fetch (passed through to distilly). */
export type FetchSize = 's' | 'm' | 'l' | 'f';

/** The fully-resolved config every webveil module consumes. */
export interface Config {
	backend: string;
	baseUrl: string;
	apiKey?: string;
	/**
	 * The BACKEND-hop egress (webveil -> backend `baseUrl`). Also the FETCH-hop
	 * default when `fetchEgress` is unset, so a single-knob config governs both
	 * hops exactly as before.
	 */
	egress: Egress;
	/**
	 * The FETCH-hop egress (webveil -> arbitrary public URL, and the `fetch`
	 * injected into distilly). OPTIONAL: when unset it INHERITS `egress`, so
	 * existing single-`egress` configs are unchanged. Setting it lets a LOCAL
	 * backend stay on a `direct` backend hop while `web_fetch` exits via a
	 * proxy (e.g. local SearXNG + socks5 web_fetch). See docs/adr/0003.
	 */
	fetchEgress?: Egress;
	fetchSize: FetchSize;
}

/** A config file / env layer: any subset of the resolved shape. */
export type PartialConfig = Partial<Config>;

export interface ResolveOptions {
	/** Directory the per-folder walk starts from. Defaults to process.cwd(). */
	cwd?: string;
	/** Environment to read overrides from. Defaults to process.env. */
	env?: Record<string, string | undefined>;
	/** Home directory for the XDG fallback. Defaults to os.homedir(). */
	homeDir?: string;
	/**
	 * Path to the global config file. When given it WINS outright and the XDG
	 * resolution is skipped. Tests point this at a temp dir to isolate the real
	 * home directory. When absent, the global file resolves to
	 * $XDG_CONFIG_HOME/webveil/config.json, falling back to
	 * <homeDir>/.config/webveil/config.json.
	 */
	globalPath?: string;
}

const DEFAULTS: Config = {
	backend: 'searxng',
	baseUrl: 'http://127.0.0.1:8080',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

const PROJECT_FILE = 'webveil.json';

function readJson(path: string): PartialConfig | undefined {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		return undefined; // absent file is fine; missing layers are expected
	}
	return JSON.parse(text) as PartialConfig;
}

/** The nearest `webveil.json` walking up from `cwd` (first found wins). */
function readProjectChain(cwd: string): PartialConfig | undefined {
	let dir = cwd;
	const {root} = parse(dir);
	for (;;) {
		const found = readJson(join(dir, PROJECT_FILE));
		if (found) return found;
		if (dir === root) return undefined;
		dir = dirname(dir);
	}
}

/**
 * Parse an egress mode/url pair into an `Egress`, or `undefined` when the mode
 * env var is unset (so the layer leaves the key absent and lower layers fill it).
 * Shared by the backend (`WEBVEIL_EGRESS*`) and fetch (`WEBVEIL_FETCH_EGRESS*`)
 * env knobs so the two hops parse identically.
 */
function parseEgressEnv(
	mode: string | undefined,
	url: string | undefined,
): Egress | undefined {
	if (mode === 'direct') return {mode: 'direct'};
	if (mode === 'http' || mode === 'socks5') return {mode, url: url ?? ''};
	return undefined;
}

function readEnv(env: Record<string, string | undefined>): PartialConfig {
	const layer: PartialConfig = {};
	if (env.WEBVEIL_BACKEND) layer.backend = env.WEBVEIL_BACKEND;
	if (env.WEBVEIL_BASE_URL) layer.baseUrl = env.WEBVEIL_BASE_URL;
	if (env.WEBVEIL_API_KEY) layer.apiKey = env.WEBVEIL_API_KEY;
	if (env.WEBVEIL_FETCH_SIZE)
		layer.fetchSize = env.WEBVEIL_FETCH_SIZE as FetchSize;
	const egress = parseEgressEnv(env.WEBVEIL_EGRESS, env.WEBVEIL_EGRESS_URL);
	if (egress) layer.egress = egress;
	const fetchEgress = parseEgressEnv(
		env.WEBVEIL_FETCH_EGRESS,
		env.WEBVEIL_FETCH_EGRESS_URL,
	);
	if (fetchEgress) layer.fetchEgress = fetchEgress;
	return layer;
}

/**
 * The global config path, XDG-style: `$XDG_CONFIG_HOME/webveil/config.json`,
 * falling back to `<homeDir>/.config/webveil/config.json` when XDG_CONFIG_HOME
 * is unset. (`options.globalPath`, when given, bypasses this entirely.)
 */
function resolveGlobalPath(
	env: Record<string, string | undefined>,
	homeDir = homedir(),
): string {
	const base = env.XDG_CONFIG_HOME || join(homeDir, '.config');
	return join(base, 'webveil', 'config.json');
}

/**
 * Resolve the effective config. Higher-precedence layers override lower ones,
 * key by key: env > project chain > global file > defaults.
 */
export function resolveConfig(options: ResolveOptions = {}): Config {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const globalPath =
		options.globalPath ?? resolveGlobalPath(env, options.homeDir);

	const layers: PartialConfig[] = [
		DEFAULTS,
		readJson(globalPath) ?? {},
		readProjectChain(cwd) ?? {},
		readEnv(env),
	];
	return Object.assign({}, ...layers) as Config;
}
