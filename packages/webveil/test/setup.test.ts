// The setup commands (`install-libcurl`, `install-recipes`, `recipes`,
// `doctor`), driven through the CLI with searchcast's REAL installers against a
// local release server and a temporary XDG_DATA_HOME, as searchcast's own
// installer tests do: the real data directory is never touched, and nothing
// leaves the machine. Also: they are not MCP tools, and search/fetch never
// load the install code.

import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import type {Server} from 'node:http';
import {connect, createServer as createNetServer} from 'node:net';
import type {AddressInfo} from 'node:net';
import {createRequire} from 'node:module';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import * as realInstall from 'searchcast/install';
import type {InstallOptions, InstallRecipesOptions} from 'searchcast/install';
import {createCli} from '../src/cli.js';
import {resolveConfig} from '../src/core/config.js';
import type {InstallApi, SetupDeps} from '../src/setup.js';
import {redactUrl} from '../src/setup.js';

// ---- isolation: a temporary XDG_DATA_HOME, the real one untouched ----------

// Both searchcast's data directory and serpcast's old one (read for one
// release, never written).
const realData = ['searchcast', 'serpcast'].map((name) =>
	join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), name),
);
const realDataMtime = () =>
	realData.map((dir) => (existsSync(dir) ? statSync(dir).mtimeMs : undefined));
const realBefore = realDataMtime();
const savedDataHome = process.env.XDG_DATA_HOME;
let root: string;
let dataHome: string;
let server: Server;
let base: string;
/** url path -> body the release server answers. */
const served = new Map<string, Buffer>();
/** Every url path the release server was asked for. */
const requested: string[] = [];

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'webveil-setup-'));
	dataHome = join(root, 'data');
	process.env.XDG_DATA_HOME = dataHome;
	server = createServer((req, res) => {
		requested.push(req.url ?? '');
		const body = served.get(req.url ?? '');
		res.statusCode = body ? 200 : 404;
		res.end(body ?? 'not found');
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
	await new Promise((r) => server.close(r));
	if (savedDataHome === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = savedDataHome;
	rmSync(root, {recursive: true, force: true});
	expect(realDataMtime()).toEqual(realBefore);
});

afterEach(() => {
	rmSync(dataHome, {recursive: true, force: true});
	served.clear();
	requested.length = 0;
});

// ---- a minimal .tar.gz writer (ustar headers, regular files only) ----------

function targz(files: Record<string, string | Buffer>): Buffer {
	const blocks: Buffer[] = [];
	for (const [name, content] of Object.entries(files)) {
		const data = Buffer.from(content);
		const header = Buffer.alloc(512);
		header.write(name, 0, 100);
		header.write('0000644\0', 100);
		header.write('0000000\0', 108);
		header.write('0000000\0', 116);
		header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
		header.write('00000000000\0', 136);
		header.write('        ', 148);
		header.write('0', 156);
		header.write('ustar\0', 257);
		header.write('00', 263);
		const sum = header.reduce((a, b) => a + b, 0);
		header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
		blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocks));
}

const sha256 = (data: Buffer) =>
	createHash('sha256').update(data).digest('hex');

// ---- the CLI with the real installers, a local release, recorded calls ------

const LIBRARY = 'lib/libcurl-impersonate.so.test';

/** Serve a libcurl release archive holding `content`; returns its Release. */
function serveRelease(content: string): realInstall.Release {
	const archive = targz({[LIBRARY]: content});
	served.set('/release/libcurl.tar.gz', archive);
	return {
		version: 'test',
		baseUrl: `${base}release/`,
		assets: {
			[`${process.platform}-${process.arch}`]: {
				archive: 'libcurl.tar.gz',
				sha256: sha256(archive),
				library: LIBRARY,
			},
		},
	};
}

/** The real install API, with the local release and each call's options recorded. */
function installApi(release?: realInstall.Release) {
	const calls: {libcurl: InstallOptions[]; recipes: InstallRecipesOptions[]} = {
		libcurl: [],
		recipes: [],
	};
	const api: InstallApi = {
		...realInstall,
		installLibcurl: (options = {}) => {
			calls.libcurl.push(options);
			return realInstall.installLibcurl({...options, release});
		},
		installRecipes: (source, options) => {
			calls.recipes.push(options);
			return realInstall.installRecipes(source, options);
		},
	};
	return {api, calls};
}

/** An isolated config with the default (direct) egress, never the user's. */
const directConfig = () =>
	resolveConfig({cwd: root, globalPath: join(root, 'no-config.json'), env: {}});

/** Serve the CLI; returns stdout, the exit code and the progress lines. */
async function run(argv: string[], setup: SetupDeps) {
	const log: string[] = [];
	const cli = createCli({
		setup: {log: (l) => log.push(l), resolveConfig: directConfig, ...setup},
	});
	let out = '';
	let code = 0;
	await cli.serve([...argv, '--format', 'json'], {
		stdout(s) {
			out += s;
		},
		exit(c) {
			code = c;
		},
	});
	return {out, code, log};
}

const libraryPath = () => join(dataHome, 'searchcast', libraryName());
const libraryName = () =>
	process.platform === 'win32'
		? 'libcurl-impersonate.dll'
		: process.platform === 'darwin'
			? 'libcurl-impersonate.dylib'
			: 'libcurl-impersonate.so';

describe('webveil install-libcurl', () => {
	it('downloads the pinned release, verifies it and installs it in the data directory (direct by default)', async () => {
		const {api, calls} = installApi(serveRelease('LIBRARY v1'));
		const res = await run(['install-libcurl'], {loadInstall: async () => api});
		expect(res.code).toBe(0);
		const path = libraryPath();
		expect(readFileSync(path, 'utf8')).toBe('LIBRARY v1');
		expect(JSON.parse(res.out)).toMatchObject({path, status: 'installed'});
		// What and where, on the progress sink.
		expect(res.log.join('\n')).toContain('libcurl.tar.gz');
		expect(res.log.join('\n')).toContain(path);
		// No proxy unless typed: never the configured egress.
		expect(calls.libcurl[0]).not.toHaveProperty('proxy');
		expect(calls.libcurl[0]!.force).toBe(false);
	});

	it('leaves an identical library alone, refuses a different one, replaces it with --force', async () => {
		let {api} = installApi(serveRelease('LIBRARY v1'));
		await run(['install-libcurl'], {loadInstall: async () => api});
		expect(
			JSON.parse(
				(await run(['install-libcurl'], {loadInstall: async () => api})).out,
			),
		).toMatchObject({status: 'unchanged'});
		({api} = installApi(serveRelease('LIBRARY v2')));
		const refused = await run(['install-libcurl'], {
			loadInstall: async () => api,
		});
		expect(refused.code).toBe(1);
		expect(refused.out).toMatch(/--force/);
		expect(readFileSync(libraryPath(), 'utf8')).toBe('LIBRARY v1');
		const forced = await run(['install-libcurl', '--force'], {
			loadInstall: async () => api,
		});
		expect(JSON.parse(forced.out)).toMatchObject({status: 'replaced'});
		expect(readFileSync(libraryPath(), 'utf8')).toBe('LIBRARY v2');
	});

	it('installs nothing on a checksum mismatch', async () => {
		const release = serveRelease('LIBRARY v1');
		const asset = Object.values(release.assets)[0]!;
		const bad = {
			...release,
			assets: {
				[`${process.platform}-${process.arch}`]: {
					...asset,
					sha256: '0'.repeat(64),
				},
			},
		};
		const {api} = installApi(bad);
		const res = await run(['install-libcurl'], {loadInstall: async () => api});
		expect(res.code).toBe(1);
		expect(res.out).toMatch(/checksum mismatch/);
		expect(existsSync(join(dataHome, 'searchcast'))).toBe(false);
	});

	it('hands --proxy to the installer', async () => {
		const seen: InstallOptions[] = [];
		const api: InstallApi = {
			...realInstall,
			installLibcurl: async (options = {}) => {
				seen.push(options);
				return {path: '/x', url: 'https://x', status: 'unchanged'};
			},
		};
		await run(['install-libcurl', '--proxy', 'socks5h://127.0.0.1:9050'], {
			loadInstall: async () => api,
		});
		expect(seen[0]!.proxy).toBe('socks5h://127.0.0.1:9050');
	});
});

const RECIPE = JSON.stringify({
	navigate: {url: 'https://web.test/?q={query}'},
	ready: '.r',
	results: {item: '.r', fields: {title: {}, url: {attr: 'href'}}},
});

/** Serve a recipe set archive `my-set/` with a manifest and one recipe. */
function serveSet(): {url: string; sha: string; archive: Buffer} {
	const archive = targz({
		'my-set/manifest.json': JSON.stringify({name: 'my-set', version: '1.2.0'}),
		'my-set/web.json': RECIPE,
	});
	served.set('/my-set-1.2.0.tar.gz', archive);
	return {url: `${base}my-set-1.2.0.tar.gz`, sha: sha256(archive), archive};
}

describe('webveil install-recipes and webveil recipes', () => {
	it('installs a pinned set from a URL into the recipes directory, then lists it', async () => {
		const {url, sha} = serveSet();
		const {api, calls} = installApi();
		const res = await run(['install-recipes', url, '--sha256', sha], {
			loadInstall: async () => api,
		});
		expect(res.code).toBe(0);
		const dir = join(dataHome, 'searchcast', 'recipes', 'my-set');
		expect(JSON.parse(res.out)).toMatchObject({
			name: 'my-set',
			dir,
			status: 'installed',
		});
		expect(readFileSync(join(dir, 'web.json'), 'utf8')).toBe(RECIPE);
		expect(calls.recipes[0]).not.toHaveProperty('proxy');
		const listed = await run(['recipes'], {loadInstall: async () => api});
		const data = JSON.parse(listed.out);
		expect(data.dir).toBe(join(dataHome, 'searchcast', 'recipes'));
		expect(data.sets).toEqual([
			expect.objectContaining({
				name: 'my-set',
				dir,
				version: '1.2.0',
				source: url,
				sha256: sha,
			}),
		]);
		expect(data.sets[0].files.join(' ')).toContain('web.json');
	});

	it('installs from a local file too, and --name renames the set', async () => {
		const {archive, sha} = serveSet();
		const file = join(root, 'set.tar.gz');
		writeFileSync(file, archive);
		const {api} = installApi();
		const res = await run(
			['install-recipes', file, '--sha256', sha, '--name', 'other'],
			{loadInstall: async () => api},
		);
		expect(res.code).toBe(0);
		expect(
			existsSync(join(dataHome, 'searchcast', 'recipes', 'other', 'web.json')),
		).toBe(true);
	});

	it('requires the pin, and installs nothing when it does not match', async () => {
		const {url} = serveSet();
		const {api, calls} = installApi();
		const missing = await run(['install-recipes', url], {
			loadInstall: async () => api,
		});
		expect(missing.code).not.toBe(0);
		expect(calls.recipes).toHaveLength(0);
		const wrong = await run(
			['install-recipes', url, '--sha256', '0'.repeat(64)],
			{loadInstall: async () => api},
		);
		expect(wrong.code).toBe(1);
		expect(existsSync(join(dataHome, 'searchcast', 'recipes', 'my-set'))).toBe(
			false,
		);
	});

	it('lists nothing when no set is installed', async () => {
		const res = await run(['recipes'], {loadInstall: async () => realInstall});
		expect(JSON.parse(res.out)).toEqual({
			dir: join(dataHome, 'searchcast', 'recipes'),
			sets: [],
		});
	});
});

/** Every file under `dir` with its content (a snapshot to compare). */
function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const entry of readdirSync(dir, {recursive: true, withFileTypes: true}))
		if (entry.isFile()) {
			const path = join(entry.parentPath, entry.name);
			out[path] = readFileSync(path, 'utf8');
		}
	return out;
}

describe("serpcast's old data directory (searchcast ADR 0005)", () => {
	const oldDir = () => join(dataHome, 'serpcast');

	/** An old data directory holding a library and the sets `names`. */
	function placeOld(...names: string[]) {
		mkdirSync(oldDir(), {recursive: true});
		writeFileSync(join(oldDir(), libraryName()), 'OLD LIBRARY');
		for (const name of names) {
			mkdirSync(join(oldDir(), 'recipes', name), {recursive: true});
			writeFileSync(join(oldDir(), 'recipes', name, 'web.json'), RECIPE);
		}
	}

	it('the installers write only to the new data directory, the old one untouched', async () => {
		placeOld('my-set', 'legacy');
		const before = snapshot(oldDir());
		const {api} = installApi(serveRelease('LIBRARY v1'));
		const lib = await run(['install-libcurl'], {loadInstall: async () => api});
		expect(lib.code).toBe(0);
		expect(readFileSync(libraryPath(), 'utf8')).toBe('LIBRARY v1');
		const {url, sha} = serveSet();
		const set = await run(['install-recipes', url, '--sha256', sha], {
			loadInstall: async () => api,
		});
		expect(set.code).toBe(0);
		expect(
			existsSync(join(dataHome, 'searchcast', 'recipes', 'my-set', 'web.json')),
		).toBe(true);
		expect(snapshot(oldDir())).toEqual(before);
	});

	it('`recipes` lists the old sets after the new ones, saying which are used', async () => {
		placeOld('my-set', 'legacy');
		const {url, sha} = serveSet();
		const {api} = installApi();
		await run(['install-recipes', url, '--sha256', sha], {
			loadInstall: async () => api,
		});
		const data = JSON.parse(
			(await run(['recipes'], {loadInstall: async () => api})).out,
		);
		expect(data.sets.map((s: {name: string}) => s.name)).toEqual(['my-set']);
		expect(data.oldDir).toBe(join(oldDir(), 'recipes'));
		expect(data.oldSets).toEqual([
			expect.objectContaining({name: 'legacy', used: true}),
			expect.objectContaining({name: 'my-set', used: false}),
		]);
	});
});

describe('the download route under a proxy egress', () => {
	let project: string;
	let globalPath: string;
	let proxy: Server;
	let proxyUrl: string;
	/** Every CONNECT target the test proxy tunnelled. */
	const tunnelled: string[] = [];
	/** The proxy-authorization of each CONNECT ('' when none). */
	const proxyAuth: string[] = [];
	let socks: SocksProxy;

	beforeAll(async () => {
		socks = await socksProxy();
		project = join(root, 'route-repo');
		globalPath = join(root, 'route-xdg', 'webveil', 'config.json');
		proxy = createServer((_req, res) => {
			res.statusCode = 405;
			res.end();
		});
		proxy.on('connect', (req, client, head) => {
			tunnelled.push(req.url ?? '');
			proxyAuth.push(req.headers['proxy-authorization'] ?? '');
			const [host, port] = (req.url ?? '').split(':');
			const upstream = connect(Number(port), host, () => {
				client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
				upstream.write(head);
				upstream.pipe(client);
				client.pipe(upstream);
			});
			upstream.on('error', () => client.destroy());
			client.on('error', () => upstream.destroy());
		});
		await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
		proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
	});

	afterAll(async () => {
		proxy.closeAllConnections();
		await new Promise((r) => proxy.close(r));
		await socks.close();
	});

	afterEach(() => {
		rmSync(project, {recursive: true, force: true});
		rmSync(dirname(globalPath), {recursive: true, force: true});
		tunnelled.length = 0;
		proxyAuth.length = 0;
		socks.seen.length = 0;
	});

	function write(path: string, value: unknown) {
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, JSON.stringify(value));
	}

	/** Seams: the recording install API and this folder's config. */
	function deps(api: InstallApi, env: Record<string, string> = {}): SetupDeps {
		return {
			loadInstall: async () => api,
			resolveConfig: () => resolveConfig({cwd: project, globalPath, env}),
		};
	}

	const SOCKS = 'socks5://user:secret@127.0.0.1:9050';
	const configs: [string, () => Record<string, string>, string][] = [
		[
			'an http egress in the global config',
			() => {
				write(globalPath, {
					egress: {mode: 'http', url: 'http://user:secret@proxy.test:3128'},
				});
				return {};
			},
			'--proxy http://***@proxy.test:3128',
		],
		[
			'a socks5 egress in the project config',
			() => {
				write(join(project, 'webveil.json'), {
					egress: {mode: 'socks5', url: SOCKS},
				});
				return {};
			},
			'--proxy socks5h://***@127.0.0.1:9050',
		],
		[
			'a socks5 egress from env',
			() => ({WEBVEIL_EGRESS: 'socks5', WEBVEIL_EGRESS_URL: SOCKS}),
			'--proxy socks5h://***@127.0.0.1:9050',
		],
		[
			'a socks5 fetchEgress only (the backend hop direct)',
			() => {
				write(join(project, 'webveil.json'), {
					fetchEgress: {mode: 'socks5', url: SOCKS},
				});
				return {};
			},
			'--proxy socks5h://***@127.0.0.1:9050',
		],
	];

	for (const [label, setUp, suggestion] of configs) {
		it(`refuses a download with no route, before any request: ${label}`, async () => {
			const env = setUp();
			const {api, calls} = installApi(serveRelease('LIBRARY v1'));
			const {url, sha} = serveSet();
			for (const argv of [
				['install-libcurl'],
				['install-recipes', url, '--sha256', sha],
			]) {
				const res = await run(argv, deps(api, env));
				expect(res.code).toBe(2);
				const error = JSON.parse(res.out);
				expect(error.code).toBe('ROUTE_REQUIRED');
				expect(error.message).toContain(suggestion);
				expect(error.message).toContain('--direct');
				// --egress is offered first: the likely intent.
				const at = (s: string) => error.message.indexOf(s);
				expect(at('--egress')).toBeGreaterThan(-1);
				expect(at('--egress')).toBeLessThan(at('--proxy '));
				expect(at('--egress')).toBeLessThan(at('--direct'));
				expect(error.message).toMatch(/own IP/);
				expect(error.message).toMatch(/fetchEgress|egress: /);
				expect(res.out).not.toContain('secret');
			}
			expect(requested).toEqual([]);
			expect(calls.libcurl).toHaveLength(0);
			expect(calls.recipes).toHaveLength(0);
			expect(existsSync(join(dataHome, 'searchcast'))).toBe(false);
		});
	}

	it('--direct downloads directly', async () => {
		write(join(project, 'webveil.json'), {
			egress: {mode: 'socks5', url: SOCKS},
		});
		const {api, calls} = installApi(serveRelease('LIBRARY v1'));
		const res = await run(['install-libcurl', '--direct'], deps(api));
		expect(res.code).toBe(0);
		expect(readFileSync(libraryPath(), 'utf8')).toBe('LIBRARY v1');
		expect(calls.libcurl[0]).not.toHaveProperty('proxy');
		const {url, sha} = serveSet();
		const set = await run(
			['install-recipes', url, '--sha256', sha, '--direct'],
			deps(api),
		);
		expect(set.code).toBe(0);
		expect(calls.recipes[0]).not.toHaveProperty('proxy');
		expect(tunnelled).toEqual([]);
		expect(requested).toContain('/my-set-1.2.0.tar.gz');
	});

	it('--proxy goes through the given proxy', async () => {
		write(join(project, 'webveil.json'), {
			egress: {mode: 'socks5', url: SOCKS},
		});
		const {api} = installApi(serveRelease('LIBRARY v1'));
		const res = await run(['install-libcurl', '--proxy', proxyUrl], deps(api));
		expect(res.code).toBe(0);
		expect(readFileSync(libraryPath(), 'utf8')).toBe('LIBRARY v1');
		const {url, sha} = serveSet();
		const set = await run(
			['install-recipes', url, '--sha256', sha, '--proxy', proxyUrl],
			deps(api),
		);
		expect(set.code).toBe(0);
		const authority = new URL(base).host;
		expect(tunnelled).toEqual([authority, authority]);
	});

	it('refuses --proxy with --direct, whatever the egress and the source', async () => {
		const {api, calls} = installApi(serveRelease('LIBRARY v1'));
		const {archive, sha} = serveSet();
		const file = join(root, 'route-set.tar.gz');
		writeFileSync(file, archive);
		for (const argv of [
			['install-libcurl'],
			['install-recipes', file, '--sha256', sha],
		]) {
			const res = await run(
				[...argv, '--proxy', proxyUrl, '--direct'],
				deps(api),
			);
			expect(res.code).toBe(2);
			expect(JSON.parse(res.out).code).toBe('CONFLICTING_OPTIONS');
		}
		expect(calls.libcurl).toHaveLength(0);
		expect(calls.recipes).toHaveLength(0);
		expect(requested).toEqual([]);
	});

	it('needs no route for a local file', async () => {
		write(join(project, 'webveil.json'), {
			egress: {mode: 'socks5', url: SOCKS},
		});
		const {archive, sha} = serveSet();
		const file = join(root, 'route-set.tar.gz');
		writeFileSync(file, archive);
		const {api} = installApi();
		const res = await run(
			['install-recipes', file, '--sha256', sha],
			deps(api),
		);
		expect(res.code).toBe(0);
		expect(
			existsSync(join(dataHome, 'searchcast', 'recipes', 'my-set', 'web.json')),
		).toBe(true);
		expect(requested).toEqual([]);
	});

	/** Run both install commands (libcurl, then a set from a URL) with `flags`. */
	async function installBoth(flags: string[], setup: SetupDeps) {
		const {url, sha} = serveSet();
		const lib = await run(['install-libcurl', ...flags], setup);
		const set = await run(
			['install-recipes', url, '--sha256', sha, ...flags],
			setup,
		);
		return [lib, set];
	}

	const withAuth = (url: string) => url.replace('://', '://user:secret@');
	const authority = () => new URL(base).host;

	describe('--egress', () => {
		it('goes through an authenticated http egress from the global config, never printing its credentials', async () => {
			write(globalPath, {egress: {mode: 'http', url: withAuth(proxyUrl)}});
			const {api} = installApi(serveRelease('LIBRARY v1'));
			for (const res of await installBoth(['--egress'], deps(api))) {
				expect(res.code).toBe(0);
				expect(res.log.join('\n')).toMatch(
					/--egress: downloading through egress \(http:\/\/\*\*\*@/,
				);
				expect(res.out + res.log.join('\n')).not.toContain('secret');
			}
			expect(readFileSync(libraryPath(), 'utf8')).toBe('LIBRARY v1');
			expect(tunnelled).toEqual([authority(), authority()]);
			const basic = `Basic ${Buffer.from('user:secret').toString('base64')}`;
			expect(proxyAuth).toEqual([basic, basic]);
			expect(socks.seen).toEqual([]);
		});

		it('goes through an authenticated socks5 egress from the project config, as socks5h', async () => {
			write(join(project, 'webveil.json'), {
				egress: {mode: 'socks5', url: withAuth(socks.url)},
			});
			const {api, calls} = installApi(serveRelease('LIBRARY v1'));
			for (const res of await installBoth(['--egress'], deps(api))) {
				expect(res.code).toBe(0);
				expect(res.out + res.log.join('\n')).not.toContain('secret');
			}
			expect(calls.libcurl[0]!.proxy).toBe(
				withAuth(socks.url).replace('socks5:', 'socks5h:'),
			);
			expect(calls.recipes[0]!.proxy).toBe(calls.libcurl[0]!.proxy);
			expect(socks.seen).toEqual([
				{target: authority(), user: 'user', password: 'secret'},
				{target: authority(), user: 'user', password: 'secret'},
			]);
			expect(tunnelled).toEqual([]);
		});

		it('goes through a socks5 egress from env', async () => {
			const env = {WEBVEIL_EGRESS: 'socks5', WEBVEIL_EGRESS_URL: socks.url};
			const {api} = installApi(serveRelease('LIBRARY v1'));
			for (const res of await installBoth(['--egress'], deps(api, env)))
				expect(res.code).toBe(0);
			expect(socks.seen).toEqual([
				{target: authority()},
				{target: authority()},
			]);
		});

		it('uses fetchEgress when it is the only proxied hop', async () => {
			write(join(project, 'webveil.json'), {
				fetchEgress: {mode: 'socks5', url: socks.url},
			});
			const {api} = installApi(serveRelease('LIBRARY v1'));
			const [lib] = await installBoth(['--egress'], deps(api));
			expect(lib!.code).toBe(0);
			expect(lib!.log.join('\n')).toContain('downloading through fetchEgress');
			expect(socks.seen).toHaveLength(2);
		});

		it('uses egress when both hops are proxies that differ, and says so', async () => {
			write(join(project, 'webveil.json'), {
				egress: {mode: 'http', url: proxyUrl},
				fetchEgress: {mode: 'socks5', url: withAuth(socks.url)},
			});
			const {api} = installApi(serveRelease('LIBRARY v1'));
			const [lib] = await installBoth(['--egress'], deps(api));
			expect(lib!.code).toBe(0);
			const log = lib!.log.join('\n');
			expect(log).toContain('downloading through egress');
			expect(log).toMatch(
				/fetchEgress \(socks5h:\/\/\*\*\*@[^)]*\) differs and is not used/,
			);
			expect(log).not.toContain('secret');
			expect(tunnelled).toHaveLength(2);
			expect(socks.seen).toEqual([]);
		});

		it('downloads directly when every hop is direct, and says so', async () => {
			write(join(project, 'webveil.json'), {egress: {mode: 'direct'}});
			const {api, calls} = installApi(serveRelease('LIBRARY v1'));
			const [lib, set] = await installBoth(['--egress'], deps(api));
			expect(lib!.code).toBe(0);
			expect(set!.code).toBe(0);
			expect(lib!.log.join('\n')).toMatch(
				/every configured egress hop is direct/,
			);
			expect(calls.libcurl[0]).not.toHaveProperty('proxy');
			expect(calls.recipes[0]).not.toHaveProperty('proxy');
			expect(tunnelled).toEqual([]);
			expect(socks.seen).toEqual([]);
		});

		const unbuildable: [string, unknown][] = [
			[
				'an https:// http proxy (the downloader cannot use it)',
				{mode: 'http', url: 'https://user:secret@proxy.test:3128'},
			],
			[
				'a socks5 egress with an http:// url',
				{mode: 'socks5', url: 'http://user:secret@proxy.test:3128'},
			],
			['a malformed url', {mode: 'socks5', url: 'socks5://user:secret@'}],
		];
		for (const [label, egress] of unbuildable)
			it(`fails loud before any request on an unbuildable egress: ${label}`, async () => {
				write(join(project, 'webveil.json'), {egress});
				const {api, calls} = installApi(serveRelease('LIBRARY v1'));
				for (const res of await installBoth(['--egress'], deps(api))) {
					expect(res.code).toBe(1);
					expect(res.out).toMatch(/Nothing was downloaded/);
					expect(res.out + res.log.join('\n')).not.toContain('secret');
				}
				expect(calls.libcurl).toHaveLength(0);
				expect(calls.recipes).toHaveLength(0);
				expect(requested).toEqual([]);
			});

		it('conflicts with --proxy and --direct, whatever the source', async () => {
			const {api, calls} = installApi(serveRelease('LIBRARY v1'));
			const {archive, sha} = serveSet();
			const file = join(root, 'route-set.tar.gz');
			writeFileSync(file, archive);
			for (const other of [['--proxy', proxyUrl], ['--direct']])
				for (const argv of [
					['install-libcurl'],
					['install-recipes', file, '--sha256', sha],
				]) {
					const res = await run([...argv, '--egress', ...other], deps(api));
					expect(res.code).toBe(2);
					const error = JSON.parse(res.out);
					expect(error.code).toBe('CONFLICTING_OPTIONS');
					expect(error.message).toContain(`--egress and ${other[0]}`);
				}
			expect(calls.libcurl).toHaveLength(0);
			expect(calls.recipes).toHaveLength(0);
			expect(requested).toEqual([]);
		});

		it('is accepted and ignored for a local file (the config is not even read)', async () => {
			const {archive, sha} = serveSet();
			const file = join(root, 'route-set.tar.gz');
			writeFileSync(file, archive);
			const {api, calls} = installApi();
			const res = await run(
				['install-recipes', file, '--sha256', sha, '--egress'],
				{
					loadInstall: async () => api,
					resolveConfig: () => {
						throw new Error('the config was resolved');
					},
				},
			);
			expect(res.code).toBe(0);
			expect(calls.recipes[0]).not.toHaveProperty('proxy');
			expect(requested).toEqual([]);
		});
	});

	it('a direct egress downloads directly with no flag', async () => {
		write(join(project, 'webveil.json'), {egress: {mode: 'direct'}});
		const {api, calls} = installApi(serveRelease('LIBRARY v1'));
		const res = await run(['install-libcurl'], deps(api));
		expect(res.code).toBe(0);
		expect(calls.libcurl[0]).not.toHaveProperty('proxy');
	});
});

interface SocksProxy {
	url: string;
	/** Each CONNECT: its target, and the credentials when the client sent them. */
	seen: {target: string; user?: string; password?: string}[];
	close(): Promise<void>;
}

/** A minimal SOCKS5 proxy (no-auth or user/password, CONNECT only) for tests. */
async function socksProxy(): Promise<SocksProxy> {
	const seen: SocksProxy['seen'] = [];
	const sockets = new Set<import('node:net').Socket>();
	const server = createNetServer((client) => {
		sockets.add(client);
		client.on('close', () => sockets.delete(client));
		client.on('error', () => client.destroy());
		let buffer = Buffer.alloc(0);
		let stage: 'greet' | 'auth' | 'connect' | 'open' = 'greet';
		let creds: {user?: string; password?: string} = {};
		client.on('data', function onData(chunk: Buffer) {
			buffer = Buffer.concat([buffer, chunk]);
			for (;;) {
				if (stage === 'greet') {
					if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
					const methods = [...buffer.subarray(2, 2 + buffer[1]!)];
					buffer = buffer.subarray(2 + buffer[1]!);
					const auth = methods.includes(2);
					client.write(Buffer.from([5, auth ? 2 : 0]));
					stage = auth ? 'auth' : 'connect';
				} else if (stage === 'auth') {
					if (buffer.length < 2) return;
					const ulen = buffer[1]!;
					if (buffer.length < 3 + ulen) return;
					const plen = buffer[2 + ulen]!;
					if (buffer.length < 3 + ulen + plen) return;
					creds = {
						user: buffer.subarray(2, 2 + ulen).toString(),
						password: buffer.subarray(3 + ulen, 3 + ulen + plen).toString(),
					};
					buffer = buffer.subarray(3 + ulen + plen);
					client.write(Buffer.from([1, 0]));
					stage = 'connect';
				} else if (stage === 'connect') {
					if (buffer.length < 5) return;
					const type = buffer[3]!;
					const len = type === 1 ? 4 : type === 4 ? 16 : 1 + buffer[4]!;
					if (buffer.length < 4 + len + 2) return;
					const host =
						type === 1
							? [...buffer.subarray(4, 8)].join('.')
							: type === 3
								? buffer.subarray(5, 4 + len).toString()
								: '(ipv6)';
					const port = buffer.readUInt16BE(4 + len);
					const rest = buffer.subarray(4 + len + 2);
					seen.push({target: `${host}:${port}`, ...creds});
					client.off('data', onData);
					stage = 'open';
					const upstream = connect(port, host, () => {
						client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
						upstream.write(rest);
						upstream.pipe(client);
						client.pipe(upstream);
					});
					upstream.on('error', () => client.destroy());
					client.on('close', () => upstream.destroy());
					return;
				} else return;
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	return {
		url: `socks5://127.0.0.1:${(server.address() as AddressInfo).port}`,
		seen,
		close: () =>
			new Promise<void>((r) => {
				for (const s of sockets) s.destroy();
				server.close(() => r());
			}),
	};
}

/** The variables that name a library before the data directories. */
const LIBCURL_ENV = [
	'SEARCHCAST_LIBCURL_PATH',
	'SERPCAST_LIBCURL_PATH',
	'LIBCURL_PATH',
];

/** The platform package searchcast installed for this platform, if any. */
function platformPackage(): string | undefined {
	const name = `@searchcast/libcurl-${process.platform}-${process.arch}`;
	try {
		createRequire(import.meta.resolve('searchcast')).resolve(
			`${name}/package.json`,
		);
		return name;
	} catch {
		return undefined;
	}
}

describe('webveil doctor', () => {
	let project: string;
	let globalPath: string;
	const missingLib = () => join(root, 'missing', 'libcurl-impersonate.so');

	beforeAll(() => {
		project = join(root, 'repo');
		globalPath = join(root, 'xdg', 'webveil', 'config.json');
	});

	function write(path: string, value: unknown) {
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, JSON.stringify(value));
	}

	function doctorDeps(env: Record<string, string> = {}): SetupDeps {
		return {
			loadInstall: async () => realInstall,
			resolveConfig: () => resolveConfig({cwd: project, globalPath, env}),
		};
	}

	it('reports the library, backend, redacted egress, fetch transport, engines with their files and sets', async () => {
		const {archive, sha} = serveSet();
		const file = join(root, 'set.tar.gz');
		writeFileSync(file, archive);
		await realInstall.installRecipes(file, {sha256: sha, log: () => {}});
		write(globalPath, {serpcast: {libcurlPath: missingLib()}});
		write(join(project, 'webveil.json'), {
			backend: 'serpcast',
			egress: {mode: 'socks5', url: 'socks5://user:secret@127.0.0.1:9050'},
			serpcast: {recipes: ['set:my-set'], engines: ['web']},
		});
		const res = await run(['doctor'], doctorDeps());
		// No library there: impersonation is not active, so it is unhealthy.
		expect(res.code).toBe(1);
		expect(res.out).not.toContain('secret');
		const report = JSON.parse(
			JSON.parse(res.out).message.replace(/^[^\n]*\n/, ''),
		);
		expect(report).toMatchObject({
			healthy: false,
			backend: 'serpcast',
			egress: 'socks5 socks5://***@127.0.0.1:9050',
			fetchEgress: 'socks5 socks5://***@127.0.0.1:9050',
			fetchTransport: 'serpcast',
			libcurl: {
				needed: true,
				impersonating: false,
				library: {path: missingLib(), source: 'option'},
			},
			engines: [
				{
					name: 'web',
					kind: 'declarative',
					file: join(dataHome, 'searchcast', 'recipes', 'my-set', 'web.json'),
				},
			],
			sets: [{entry: 'set:my-set', installed: true}],
		});
		expect(report.problems).toHaveLength(1);
		expect(report.problems[0]).toMatch(/webveil install-libcurl/);
		expect(report).not.toHaveProperty('libcurl.remote'); // no network by default
	});

	it('reports the old-data-dir notice (with the mv command) and the library read from there, without failing on it', async () => {
		const saved = Object.fromEntries(
			LIBCURL_ENV.map((name) => [name, process.env[name]]),
		);
		for (const name of LIBCURL_ENV) delete process.env[name];
		try {
			const old = join(dataHome, 'serpcast');
			mkdirSync(join(old, 'recipes', 'legacy'), {recursive: true});
			writeFileSync(join(old, 'recipes', 'legacy', 'web.json'), RECIPE);
			writeFileSync(join(old, libraryName()), 'not a library');
			write(globalPath, {});
			write(join(project, 'webveil.json'), {
				backend: 'serpcast',
				serpcast: {recipes: ['set:legacy'], engines: ['web']},
			});
			const res = await run(['doctor'], doctorDeps());
			const report = JSON.parse(
				JSON.parse(res.out).message.replace(/^[^\n]*\n/, ''),
			);
			expect(report).toMatchObject({
				libcurl: {
					library: {
						path: join(old, libraryName()),
						source: 'old data directory',
					},
				},
				oldDataDir: {
					dir: old,
					newDir: join(dataHome, 'searchcast'),
					items: [libraryName(), 'recipes/legacy'],
					command: `mv '${old}' '${join(dataHome, 'searchcast')}'`,
				},
				sets: [
					{
						entry: 'set:legacy',
						installed: true,
						dir: join(old, 'recipes', 'legacy'),
					},
				],
				engines: [
					{name: 'web', file: join(old, 'recipes', 'legacy', 'web.json')},
				],
			});
			expect(report).not.toHaveProperty('libcurl.oldDataDir');
			// Only the unloadable library is a problem, not the old directory.
			expect(report.problems).toHaveLength(1);
			expect(report.problems[0]).not.toMatch(/serpcast'?s? old|mv /);
		} finally {
			for (const name of LIBCURL_ENV)
				if (saved[name] === undefined) delete process.env[name];
				else process.env[name] = saved[name];
		}
	});

	it.skipIf(!platformPackage())(
		"reports the platform package as the library's source when nothing else names one",
		async () => {
			const saved = Object.fromEntries(
				LIBCURL_ENV.map((name) => [name, process.env[name]]),
			);
			for (const name of LIBCURL_ENV) delete process.env[name];
			try {
				write(globalPath, {});
				write(join(project, 'webveil.json'), {backend: 'searxng'});
				const res = await run(['doctor'], doctorDeps());
				const report = JSON.parse(res.out);
				expect(report.libcurl.library).toMatchObject({
					source: 'platform package',
					package: {name: platformPackage()},
				});
				expect(report).not.toHaveProperty('oldDataDir');
			} finally {
				for (const name of LIBCURL_ENV)
					if (saved[name] === undefined) delete process.env[name];
					else process.env[name] = saved[name];
			}
		},
	);

	it('names a configured set that is not installed', async () => {
		write(globalPath, {serpcast: {libcurlPath: missingLib()}});
		write(join(project, 'webveil.json'), {
			backend: 'serpcast',
			serpcast: {recipes: ['set:absent'], engines: ['web']},
		});
		const res = await run(['doctor'], doctorDeps());
		expect(res.code).toBe(1);
		expect(res.out).toMatch(
			/recipe set 'absent' \(set:absent\) is not installed/,
		);
		expect(res.out).toMatch(/webveil install-recipes/);
	});

	it('is healthy without the library when nothing uses it (searxng + plain fetch)', async () => {
		write(globalPath, {serpcast: {libcurlPath: missingLib()}});
		write(join(project, 'webveil.json'), {backend: 'searxng'});
		const res = await run(['doctor'], doctorDeps());
		expect(res.code).toBe(0);
		expect(JSON.parse(res.out)).toMatchObject({
			healthy: true,
			backend: 'searxng',
			egress: 'direct',
			fetchTransport: 'plain',
			libcurl: {needed: false, impersonating: false},
		});
	});
});

describe('redactUrl', () => {
	it('hides credentials and leaves other urls alone', () => {
		expect(redactUrl('socks5://u:p@h:1')).toBe('socks5://***@h:1');
		expect(redactUrl('http://h:8080')).toBe('http://h:8080');
		expect(redactUrl('not a url')).toBe('not a url');
	});
});

// ---- not over MCP, and never loaded by search/fetch -------------------------

const BIN = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The tool names the real bin serves over `--mcp`. */
function mcpToolNames(): Promise<string[]> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [BIN, '--mcp'], {
			stdio: ['pipe', 'pipe', 'inherit'],
		});
		let raw = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('--mcp server did not respond in time'));
		}, 10_000);
		child.stdout.on('data', (chunk: Buffer) => {
			raw += chunk.toString();
			for (const line of raw.split('\n')) {
				try {
					const msg = JSON.parse(line) as {
						id?: number;
						result?: {tools?: {name: string}[]};
					};
					if (msg.id !== 2) continue;
					clearTimeout(timer);
					child.kill();
					resolvePromise((msg.result?.tools ?? []).map((t) => t.name));
					return;
				} catch {
					continue;
				}
			}
		});
		const send = (msg: unknown) =>
			child.stdin.write(JSON.stringify(msg) + '\n');
		send({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {name: 'test', version: '0'},
			},
		});
		send({jsonrpc: '2.0', method: 'notifications/initialized'});
		send({jsonrpc: '2.0', id: 2, method: 'tools/list'});
	});
}

describe('setup commands are CLI only', () => {
	it.skipIf(!existsSync(BIN))(
		'the --mcp server has search and fetch, and none of the setup commands',
		async () => {
			const names = await mcpToolNames();
			expect(names).toEqual(
				expect.arrayContaining(['search', 'fetch', 'state_clear']),
			);
			for (const name of [
				'install-libcurl',
				'install-recipes',
				'recipes',
				'doctor',
			])
				expect(names).not.toContain(name);
		},
	);

	it('createCli leaves them out on request, and has them by default', async () => {
		const help = async (cli: ReturnType<typeof createCli>) => {
			let out = '';
			await cli.serve(['--help'], {stdout: (s) => void (out += s), exit() {}});
			return out;
		};
		expect(await help(createCli())).toContain('install-libcurl');
		const bare = await help(createCli({}, {setupCommands: false}));
		for (const name of [
			'install-libcurl',
			'install-recipes',
			'recipes',
			'doctor',
		])
			expect(bare).not.toMatch(new RegExp(`^\\s+${name}\\s`, 'm'));
	});
});

/**
 * Every module statically imported from `entry`: webveil's own sources (a
 * `./x.js` import is `./x.ts`) and installed packages, resolved to their
 * files. Dynamic `import()` is not followed: that is how the setup commands
 * load `searchcast/install`, only when they run.
 */
function staticImports(entry: string): Set<string> {
	const seen = new Set<string>();
	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		const text = readFileSync(file, 'utf8');
		// Type-only imports are erased from the built code: not followed.
		const specifiers = [
			...text.matchAll(
				/^\s*(?:import|export)\s+(?!type\s)[^'";]*?from\s+['"]([^'"]+)['"]/gm,
			),
			...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
		].map((m) => m[1]!);
		for (const spec of specifiers) {
			if (spec.startsWith('node:')) continue;
			if (spec.startsWith('.')) {
				const target = resolve(dirname(file), spec);
				const ts = target.replace(/\.js$/, '.ts');
				pending.push(existsSync(ts) ? ts : target);
			} else if (/^(searchcast|@searchcast\/)/.test(spec)) {
				// Follow searchcast's own graph (the package under test here).
				pending.push(createRequire(file).resolve(spec));
			}
		}
	}
	return seen;
}

describe('search and fetch never load the install code', () => {
	const src = fileURLToPath(new URL('../src/', import.meta.url));
	const install =
		/searchcast[\\/]dist[\\/](install|install-api|install-recipes|download)\.js$/;

	for (const entry of ['core/search.ts', 'core/fetch.ts', 'index.ts', 'cli.ts'])
		it(`${entry} reaches no download module statically`, () => {
			const reached = [...staticImports(join(src, entry))];
			expect(reached.filter((f) => install.test(f))).toEqual([]);
			expect(reached.length).toBeGreaterThan(3); // the walk did walk
		});

	it('the setup module imports searchcast/install only dynamically (the control)', () => {
		const text = readFileSync(join(src, 'setup.ts'), 'utf8');
		expect(text).toMatch(/import\('searchcast\/install'\)/);
		expect(text).not.toMatch(
			/^import (?!type\s)[^;]*from 'searchcast\/install'/m,
		);
		// ...and the walk would catch a static one: searchcast/install itself
		// reaches the download module.
		const direct = [
			...staticImports(
				createRequire(join(src, 'setup.ts')).resolve('searchcast/install'),
			),
		];
		expect(direct.some((f) => install.test(f))).toBe(true);
	});
});
