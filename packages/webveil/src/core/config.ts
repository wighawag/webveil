// config seam — per-folder resolution. Precedence (highest wins):
//   env > nearest .pi/webveil.json (walking up from cwd) > global
//   ~/.pi/agent/webveil.json > defaults.
// "Per folder = per account/egress." Each layer is a partial; later (lower)
// layers fill gaps the higher layers leave.

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
	egress: Egress;
	fetchSize: FetchSize;
}

/** A config file / env layer: any subset of the resolved shape. */
export type PartialConfig = Partial<Config>;

export interface ResolveOptions {
	/** Directory the per-folder walk starts from. Defaults to process.cwd(). */
	cwd?: string;
	/** Environment to read overrides from. Defaults to process.env. */
	env?: Record<string, string | undefined>;
	/**
	 * Path to the global config file. Defaults to ~/.pi/agent/webveil.json.
	 * Tests point this at a temp dir to isolate the real home directory.
	 */
	globalPath?: string;
}

const DEFAULTS: Config = {
	backend: 'searxng',
	baseUrl: 'http://127.0.0.1:8080',
	egress: {mode: 'direct'},
	fetchSize: 'm',
};

const PROJECT_FILE = join('.pi', 'webveil.json');

function readJson(path: string): PartialConfig | undefined {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		return undefined; // absent file is fine; missing layers are expected
	}
	return JSON.parse(text) as PartialConfig;
}

/** The nearest `.pi/webveil.json` walking up from `cwd` (first found wins). */
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

function readEnv(env: Record<string, string | undefined>): PartialConfig {
	const layer: PartialConfig = {};
	if (env.WEBVEIL_BACKEND) layer.backend = env.WEBVEIL_BACKEND;
	if (env.WEBVEIL_BASE_URL) layer.baseUrl = env.WEBVEIL_BASE_URL;
	if (env.WEBVEIL_API_KEY) layer.apiKey = env.WEBVEIL_API_KEY;
	if (env.WEBVEIL_FETCH_SIZE)
		layer.fetchSize = env.WEBVEIL_FETCH_SIZE as FetchSize;
	const mode = env.WEBVEIL_EGRESS;
	if (mode === 'direct') layer.egress = {mode: 'direct'};
	else if (mode === 'http' || mode === 'socks5')
		layer.egress = {mode, url: env.WEBVEIL_EGRESS_URL ?? ''};
	return layer;
}

/**
 * Resolve the effective config. Higher-precedence layers override lower ones,
 * key by key: env > project chain > global file > defaults.
 */
export function resolveConfig(options: ResolveOptions = {}): Config {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const globalPath =
		options.globalPath ?? join(homedir(), '.pi', 'agent', 'webveil.json');

	const layers: PartialConfig[] = [
		DEFAULTS,
		readJson(globalPath) ?? {},
		readProjectChain(cwd) ?? {},
		readEnv(env),
	];
	return Object.assign({}, ...layers) as Config;
}
