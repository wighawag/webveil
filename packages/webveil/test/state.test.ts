// The on-disk state store (core/state.ts): searchcast's StateStore contract,
// expiry on read, one partition per identity, 0600/0700, atomic writes under a
// lock across processes, and clearing. XDG_STATE_HOME is a temp dir for every
// test file (test/setup-state.ts), which also asserts the real one untouched.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {spawn, spawnSync} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	claimProfile,
	clearState,
	createStateStore,
	partitionDir,
	profileDir,
	releaseProfile,
	stateRoot,
	withLock,
} from '../src/core/state.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'webveil-state-test-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

const fileOf = (id: string) => join(root, id, 'state.json');
const entriesOf = (id: string) =>
	JSON.parse(readFileSync(fileOf(id), 'utf8')).entries as Record<
		string,
		unknown
	>;
const mode = (path: string) => statSync(path).mode & 0o777;

describe('state root and partitions', () => {
	it('lives under $XDG_STATE_HOME/webveil, else ~/.local/state/webveil', () => {
		expect(stateRoot({XDG_STATE_HOME: '/x/state'})).toBe('/x/state/webveil');
		expect(stateRoot({}, '/home/u')).toBe('/home/u/.local/state/webveil');
		expect(stateRoot({})).toBe(join(homedir(), '.local/state/webveil'));
	});

	it('names a partition by the identity hash only, refusing anything else', () => {
		expect(partitionDir(A, root)).toBe(join(root, A));
		for (const bad of ['../x', 'A'.repeat(64), 'a'.repeat(63), `${A}/..`])
			expect(() => partitionDir(bad, root)).toThrow(/invalid state identity/);
	});

	it('the test setup isolates XDG_STATE_HOME in a temp dir', () => {
		expect(stateRoot()).not.toBe(join(homedir(), '.local', 'state', 'webveil'));
		expect(stateRoot().startsWith(tmpdir())).toBe(true);
	});
});

describe('createStateStore: the searchcast StateStore contract', () => {
	it('stores JSON values by key, copies in and out, keys never in a path', async () => {
		const store = createStateStore(partitionDir(A, root));
		expect(await store.get('engine/x/session')).toBeUndefined();
		const value = {cookies: [{name: 'c', value: 'v'}], lastUsed: 1};
		await store.set('engine/a%2Fb/session', value);
		value.lastUsed = 2;
		const got = await store.get('engine/a%2Fb/session');
		expect(got).toEqual({cookies: [{name: 'c', value: 'v'}], lastUsed: 1});
		expect(readdirSync(root)).toEqual([A]);
		expect(readdirSync(join(root, A))).toEqual(['state.json']);
		await store.delete('engine/a%2Fb/session');
		await store.delete('absent');
		expect(await store.get('engine/a%2Fb/session')).toBeUndefined();
	});

	it('does not return an entry past its expiry, and removes it from the file', async () => {
		let now = 1000;
		const store = createStateStore(partitionDir(A, root), {now: () => now});
		await store.set('session', {v: 1}, {ttlMs: 500});
		await store.set('forever', 'kept');
		now = 1499;
		expect(await store.get('session')).toEqual({v: 1});
		now = 1500;
		expect(await store.get('session')).toBeUndefined();
		expect(entriesOf(A)).toEqual({forever: {value: 'kept'}});
		expect(await store.get('forever')).toBe('kept');
	});

	it('drops expired entries on write too', async () => {
		let now = 0;
		const store = createStateStore(partitionDir(A, root), {now: () => now});
		await store.set('old', 1, {ttlMs: 10});
		now = 20;
		await store.set('new', 2);
		expect(Object.keys(entriesOf(A))).toEqual(['new']);
	});

	it('never lets one partition see another', async () => {
		await createStateStore(partitionDir(A, root)).set('k', 'from A');
		expect(
			await createStateStore(partitionDir(B, root)).get('k'),
		).toBeUndefined();
		expect(await createStateStore(partitionDir(A, root)).get('k')).toBe(
			'from A',
		);
	});

	it('writes files 0600 and directories 0700, tightening an existing root', async () => {
		mkdirSync(root, {recursive: true, mode: 0o755});
		await createStateStore(partitionDir(A, root)).set('k', 1);
		expect(mode(root)).toBe(0o700);
		expect(mode(join(root, A))).toBe(0o700);
		expect(mode(fileOf(A))).toBe(0o600);
	});

	it('reads an unreadable file as empty and overwrites it on write', async () => {
		mkdirSync(join(root, A));
		writeFileSync(fileOf(A), 'not json');
		const store = createStateStore(partitionDir(A, root));
		expect(await store.get('k')).toBeUndefined();
		await store.set('k', 1);
		expect(entriesOf(A)).toEqual({k: {value: 1}});
	});

	it('breaks a stale lock left by a crashed writer', async () => {
		mkdirSync(join(root, A));
		const lock = join(root, A, 'state.lock');
		writeFileSync(lock, '');
		const old = (Date.now() - 60_000) / 1000;
		utimesSync(lock, old, old);
		await createStateStore(partitionDir(A, root)).set('k', 1);
		expect(entriesOf(A)).toEqual({k: {value: 1}});
		expect(existsSync(lock)).toBe(false);
	});
});

describe('createStateStore: concurrent processes', () => {
	it('applies every write from concurrent processes, leaving a valid file', async () => {
		const here = fileURLToPath(new URL('.', import.meta.url));
		const tsx = join(here, '..', 'node_modules', '.bin', 'tsx');
		const module = join(here, '..', 'src', 'core', 'state.ts');
		const script = join(root, 'writer.mts');
		writeFileSync(
			script,
			`import {createStateStore} from ${JSON.stringify(module)};
const store = createStateStore(process.argv[2]);
for (let i = 0; i < 25; i++) await store.set(process.argv[3] + '/' + i, {i});
`,
		);
		const dir = partitionDir(A, root);
		const writers = ['p0', 'p1', 'p2', 'p3'].map(
			(name) =>
				new Promise<number | null>((resolve, reject) => {
					const child = spawn(tsx, [script, dir, name], {stdio: 'inherit'});
					child.on('error', reject);
					child.on('exit', resolve);
				}),
		);
		expect(await Promise.all(writers)).toEqual([0, 0, 0, 0]);
		const keys = Object.keys(entriesOf(A));
		expect(keys).toHaveLength(100);
		for (const name of ['p0', 'p1', 'p2', 'p3'])
			for (let i = 0; i < 25; i++) expect(keys).toContain(`${name}/${i}`);
		expect(readdirSync(dir)).toEqual(['state.json']); // no lock, no temp
	}, 60_000);
});

/** Backdate a lock (a legacy lock file, or a lock directory and its token). */
const makeStale = (lock: string) => {
	const old = (Date.now() - 60_000) / 1000;
	if (statSync(lock).isDirectory())
		for (const name of readdirSync(lock))
			utimesSync(join(lock, name), old, old);
	utimesSync(lock, old, old);
};

/** A promise and its resolver. */
const signal = () => {
	let fire!: () => void;
	const fired = new Promise<void>((resolve) => (fire = resolve));
	return {fire, fired};
};

describe('withLock: breaking a stale lock', () => {
	it('lets exactly one of two waiters take over the same stale lock', async () => {
		const dir = partitionDir(A, root);
		const lock = join(dir, 'state.lock');
		// A holder that never releases (a crashed writer), made stale.
		const crashedIn = signal();
		const crash = signal();
		const crashed = withLock(dir, async () => {
			crashedIn.fire();
			await crash.fired;
		});
		await crashedIn.fired;
		makeStale(lock);

		// Both waiters stop right after judging that lock stale (the seam),
		// then the first breaks it and takes the lock, and only then the second
		// goes on with its break.
		const stops: Array<() => void> = [];
		const bothStale = signal();
		const secondMoved = signal();
		let holding = 0;
		let most = 0;
		let released = false;
		const waiter = () => {
			let first = true;
			return withLock(
				dir,
				async () => {
					most = Math.max(most, ++holding);
					if (!released) {
						released = true;
						stops[1]!();
						await secondMoved.fired; // it waits or it gets in
					} else secondMoved.fire();
					holding--;
				},
				{
					onStale: () => {
						if (!first) return Promise.resolve();
						first = false;
						return new Promise<void>((resolve) => {
							stops.push(resolve);
							if (stops.length === 2) bothStale.fire();
						});
					},
					onWait: () => secondMoved.fire(),
				},
			);
		};
		const waiters = [waiter(), waiter()];
		await bothStale.fired;
		stops[0]!();
		await Promise.all(waiters);
		expect(most).toBe(1);

		crash.fire();
		await crashed; // its lock was taken over: it releases nothing
		expect(existsSync(lock)).toBe(false);
		expect(readdirSync(dir)).toEqual([]);
	});

	it('never lets a holder release a lock it no longer owns', async () => {
		const dir = partitionDir(A, root);
		const lock = join(dir, 'state.lock');
		const secondIn = signal();
		const secondOut = signal();
		let second!: Promise<void>;
		await withLock(dir, async () => {
			makeStale(lock); // held past LOCK_STALE_MS: the next waiter takes it
			second = withLock(dir, async () => {
				secondIn.fire();
				await secondOut.fired;
			});
			await secondIn.fired;
		});
		// The first holder has released: the second's lock is still there.
		expect(existsSync(lock)).toBe(true);
		const thirdWaits = signal();
		let thirdIn = false;
		const third = withLock(
			dir,
			async () => {
				thirdIn = true;
			},
			{onWait: () => thirdWaits.fire()},
		);
		await thirdWaits.fired;
		expect(thirdIn).toBe(false);
		secondOut.fire();
		await Promise.all([second, third]);
		expect(thirdIn).toBe(true);
		expect(readdirSync(dir)).toEqual([]);
	});
});

describe('clearState', () => {
	beforeEach(async () => {
		await createStateStore(partitionDir(A, root)).set('k', 1);
		await createStateStore(partitionDir(B, root)).set('k', 2);
		mkdirSync(join(root, 'not-a-partition'));
	});

	it('removes one identity partition', async () => {
		expect(await clearState(root, A)).toEqual({cleared: [A], kept: []});
		expect(readdirSync(root).sort()).toEqual([B, 'not-a-partition']);
		expect(await clearState(root, A)).toEqual({cleared: [], kept: []});
	});

	it('removes every partition, and only partitions', async () => {
		const {cleared, kept} = await clearState(root);
		expect(cleared.sort()).toEqual([A, B]);
		expect(kept).toEqual([]);
		expect(readdirSync(root)).toEqual(['not-a-partition']);
	});

	it('is a no-op on a missing root', async () => {
		expect(await clearState(join(root, 'absent'))).toEqual({
			cleared: [],
			kept: [],
		});
	});
});

describe('clearState: a browser profile another live process owns', () => {
	const KEPT = [
		'browser-profile',
		'browser-profile.owner',
		'browser-profile.used',
	];
	let child: ChildProcess | undefined;
	/** A real live process that is not this one. */
	const liveOther = async () => {
		child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], {
			stdio: 'ignore',
		});
		await new Promise((r) => child!.once('spawn', r));
		return child.pid!;
	};
	/** The pid of a process that has exited. */
	const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
	/** Give the partition of `id` a profile, owner `owner`, a clock, a recipe file. */
	const withProfile = (id: string, owner?: string) => {
		const dir = partitionDir(id, root);
		mkdirSync(profileDir(dir), {recursive: true});
		writeFileSync(join(profileDir(dir), 'Cookies'), 'session');
		writeFileSync(join(dir, 'browser-profile.used'), '');
		if (owner !== undefined)
			writeFileSync(join(dir, 'browser-profile.owner'), owner);
		return dir;
	};

	beforeEach(async () => {
		// sessions, cooldowns and code-recipe state all live in state.json
		await createStateStore(partitionDir(A, root)).set('engine/x/session', 1);
		await createStateStore(partitionDir(A, root)).set('cooldown/x', 2);
		await createStateStore(partitionDir(A, root)).set('recipe/x/state', 3);
		await createStateStore(partitionDir(B, root)).set('k', 1);
	});
	afterEach(() => {
		child?.kill('SIGKILL');
		child = undefined;
	});

	it('keeps the profile, its owner and clock, removes the rest, and reports the owner', async () => {
		const pid = await liveOther();
		const dir = withProfile(A, `${pid}\n`);
		expect(await clearState(root, A)).toEqual({
			cleared: [],
			kept: [{identity: A, pid}],
		});
		expect(readdirSync(dir).sort()).toEqual(KEPT);
		expect(readFileSync(join(profileDir(dir), 'Cookies'), 'utf8')).toBe(
			'session',
		);
		expect(readFileSync(join(dir, 'browser-profile.owner'), 'utf8')).toBe(
			`${pid}\n`,
		);
	});

	it('removes the partition entirely with no owner, a dead one, an unreadable one, or this process', async () => {
		for (const owner of [
			undefined,
			String(deadPid()),
			'not a pid',
			String(process.pid),
		]) {
			const dir = withProfile(A, owner);
			expect(await clearState(root, A)).toEqual({cleared: [A], kept: []});
			expect(existsSync(dir)).toBe(false);
		}
	});

	it('force removes everything, owned or not', async () => {
		const pid = await liveOther();
		const dir = withProfile(A, String(pid));
		expect(await clearState(root, A, {force: true})).toEqual({
			cleared: [A],
			kept: [],
		});
		expect(existsSync(dir)).toBe(false);
	});

	it('applies the same rule to every partition', async () => {
		const pid = await liveOther();
		const dir = withProfile(A, String(pid));
		withProfile(B);
		expect(await clearState(root)).toEqual({
			cleared: [B],
			kept: [{identity: A, pid}],
		});
		expect(readdirSync(root)).toEqual([A]);
		expect(readdirSync(dir).sort()).toEqual(KEPT);
		const forced = await clearState(root, undefined, {force: true});
		expect(forced).toEqual({cleared: [A], kept: []});
		expect(readdirSync(root)).toEqual([]);
	});

	it('reads the owner under the partition lock, so it cannot race a claim', async () => {
		const pid = await liveOther();
		const dir = withProfile(A);
		let cleared: ReturnType<typeof clearState> | undefined;
		await withLock(dir, async () => {
			cleared = clearState(root, A);
			await new Promise((r) => setTimeout(r, 150));
			expect(existsSync(dir)).toBe(true);
			// a claim landing while the clear waits for the lock
			writeFileSync(join(dir, 'browser-profile.owner'), String(pid));
		});
		expect(await cleared).toEqual({cleared: [], kept: [{identity: A, pid}]});
		expect(readdirSync(dir).sort()).toEqual(KEPT);
	});
});

describe('claimProfile: the persistent browser profile under the partition lock', () => {
	const IDLE = 60_000;
	let dir: string;
	let cookie: string;
	const owner = () => join(dir, 'browser-profile.owner');
	/** A profile holding a cookie, its partition idle past IDLE. */
	const idleProfile = () => {
		mkdirSync(profileDir(dir), {recursive: true});
		writeFileSync(cookie, 'session');
		const used = join(dir, 'browser-profile.used');
		writeFileSync(used, '');
		const old = (Date.now() - 2 * IDLE) / 1000;
		utimesSync(used, old, old);
	};
	/** The pid of a process that has exited. */
	const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

	beforeEach(() => {
		dir = partitionDir(A, root);
		cookie = join(profileDir(dir), 'Cookies');
	});

	it('takes a free profile: deletes it when idle, records the owner, touches the clock', async () => {
		idleProfile();
		let closed = 0;
		const claim = await claimProfile(dir, {
			idleMs: IDLE,
			beforeDelete: async () => void closed++,
		});
		expect(claim).toBe('owned');
		expect(closed).toBe(1);
		expect(existsSync(cookie)).toBe(false);
		expect(readFileSync(owner(), 'utf8').trim()).toBe(String(process.pid));
		expect(mode(owner())).toBe(0o600);
		const used = statSync(join(dir, 'browser-profile.used')).mtimeMs;
		expect(Date.now() - used).toBeLessThan(IDLE);
		expect(readdirSync(dir)).not.toContain('state.lock');
	});

	it('keeps a recently used profile, and its own claim', async () => {
		idleProfile();
		await claimProfile(dir, {idleMs: IDLE});
		mkdirSync(profileDir(dir), {recursive: true});
		writeFileSync(cookie, 'again');
		expect(await claimProfile(dir, {idleMs: IDLE})).toBe('owned');
		expect(readFileSync(cookie, 'utf8')).toBe('again');
	});

	it('takes over the claim of a process that is gone (and an unreadable one)', async () => {
		for (const stale of [String(deadPid()), 'not a pid']) {
			idleProfile();
			writeFileSync(owner(), stale);
			expect(await claimProfile(dir, {idleMs: IDLE})).toBe('owned');
			expect(existsSync(cookie)).toBe(false);
		}
	});

	it('never deletes a profile a live process owns, however idle; still touches the clock', async () => {
		idleProfile();
		writeFileSync(owner(), String(process.ppid));
		let closed = 0;
		const claim = await claimProfile(dir, {
			idleMs: IDLE,
			beforeDelete: async () => void closed++,
		});
		expect(claim).toBe('busy');
		expect(closed).toBe(0);
		expect(readFileSync(cookie, 'utf8')).toBe('session');
		expect(readFileSync(owner(), 'utf8')).toBe(String(process.ppid));
		const used = statSync(join(dir, 'browser-profile.used')).mtimeMs;
		expect(Date.now() - used).toBeLessThan(IDLE);
	});

	it('waits for the partition lock before checking, deleting and touching', async () => {
		idleProfile();
		let claimed: Promise<string> | undefined;
		await withLock(dir, async () => {
			claimed = claimProfile(dir, {idleMs: IDLE});
			await new Promise((r) => setTimeout(r, 150));
			expect(existsSync(cookie)).toBe(true);
			expect(existsSync(owner())).toBe(false);
		});
		expect(await claimed).toBe('owned');
		expect(existsSync(cookie)).toBe(false);
	});

	it('releases only its own claim', async () => {
		await claimProfile(dir, {idleMs: IDLE});
		await releaseProfile(dir);
		expect(existsSync(owner())).toBe(false);
		writeFileSync(owner(), String(process.ppid));
		await releaseProfile(dir);
		expect(readFileSync(owner(), 'utf8')).toBe(String(process.ppid));
		await releaseProfile(join(root, B)); // no partition: nothing made
		expect(existsSync(join(root, B))).toBe(false);
	});

	it('racing processes: exactly one owns it, it is deleted once, the others are busy', async () => {
		idleProfile();
		const here = fileURLToPath(new URL('.', import.meta.url));
		const tsx = join(here, '..', 'node_modules', '.bin', 'tsx');
		const module = join(here, '..', 'src', 'core', 'state.ts');
		const log = join(root, 'deletes.log');
		const script = join(root, 'claimer.mts');
		writeFileSync(
			script,
			`import {appendFileSync} from 'node:fs';
import {claimProfile} from ${JSON.stringify(module)};
const claim = await claimProfile(process.argv[2], {
	idleMs: ${IDLE},
	beforeDelete: async () => appendFileSync(${JSON.stringify(log)}, 'x\\n'),
});
process.stdout.write(claim + '\\n');
// Stay alive (the owner's browser) until the test closes stdin.
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
`,
		);
		const children: ChildProcess[] = [];
		try {
			const claims = await Promise.all(
				[0, 1, 2, 3].map(
					() =>
						new Promise<string>((resolve, reject) => {
							const child = spawn(tsx, [script, dir], {
								stdio: ['pipe', 'pipe', 'inherit'],
							});
							children.push(child);
							let out = '';
							child.stdout!.on('data', (d) => {
								out += String(d);
								if (out.includes('\n')) resolve(out.trim());
							});
							child.on('error', reject);
							child.on('exit', (code) =>
								reject(new Error(`claimer exited ${code}`)),
							);
						}),
				),
			);
			expect(claims.sort()).toEqual(['busy', 'busy', 'busy', 'owned']);
			expect(readFileSync(log, 'utf8')).toBe('x\n');
			// The owner is alive: this process is busy too, however idle.
			mkdirSync(profileDir(dir), {recursive: true});
			writeFileSync(cookie, 'owner session');
			expect(await claimProfile(dir, {idleMs: 0})).toBe('busy');
			expect(existsSync(cookie)).toBe(true);
		} finally {
			await Promise.all(
				children.map(
					(child) =>
						new Promise((r) => {
							if (child.exitCode !== null) return r(undefined);
							child.once('exit', r);
							child.stdin!.end();
						}),
				),
			);
		}
		// Every claimer is gone: the profile is free again.
		expect(await claimProfile(dir, {idleMs: IDLE})).toBe('owned');
	}, 60_000);
});
