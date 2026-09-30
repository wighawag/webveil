// The on-disk state store (core/state.ts): searchcast's StateStore contract,
// expiry on read, one partition per identity, 0600/0700, atomic writes under a
// lock across processes, and clearing. XDG_STATE_HOME is a temp dir for every
// test file (test/setup-state.ts), which also asserts the real one untouched.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {spawn} from 'node:child_process';
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
	clearState,
	createStateStore,
	partitionDir,
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
		expect(await clearState(root, A)).toEqual([A]);
		expect(readdirSync(root).sort()).toEqual([B, 'not-a-partition']);
		expect(await clearState(root, A)).toEqual([]);
	});

	it('removes every partition, and only partitions', async () => {
		expect((await clearState(root)).sort()).toEqual([A, B]);
		expect(readdirSync(root)).toEqual(['not-a-partition']);
	});

	it('is a no-op on a missing root', async () => {
		expect(await clearState(join(root, 'absent'))).toEqual([]);
	});
});
