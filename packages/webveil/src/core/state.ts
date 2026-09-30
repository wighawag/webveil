// state: searchcast's `StateStore` on disk, one partition per identity
// (identity.ts), so the one-shot CLI keeps sessions and cooldowns between
// calls and no state ever crosses identities (docs/adr/0004).
//
// Layout: `$XDG_STATE_HOME/webveil/<identity key>/state.json` (default
// `~/.local/state/webveil/`). The partition directory is the identity's home
// for anything else it keeps on disk (the searchcast browser profile). Only the
// hash appears in a path; store keys live inside the file, never as names.
//
// Recorded decisions (task identity-partitioned-state-store):
// - One JSON file per partition, rewritten whole: searchcast keeps a handful of
//   small keys, and a single file makes "both writes applied" a plain
//   read-modify-write under the lock. Alternative: a file per key (names
//   encoded), rejected as more files and more locking for no gain.
// - Lock: a `state.lock` in the partition, held only around each
//   read-modify-write; the write itself is a temp file renamed over
//   `state.json`, so readers never take the lock and never see a partial
//   file. A lock older than LOCK_STALE_MS (a crashed writer) is broken; past
//   LOCK_WAIT_MS waiting is an error. Alternative: flock(2), rejected because
//   Node has no portable binding without a native dependency. (The lock's
//   shape and its takeover were redone by the next task.)
//
// Recorded decisions (task state-lock-stale-takeover-race):
// - The old check-then-`rm` break let two waiters that saw the same stale lock
//   both hold it (the second `rm` deleted the lock the first had just taken).
//   Now the lock is a DIRECTORY `state.lock` holding one empty file named by
//   its holder's token (pid plus random). Taking it: build
//   `state.lock.<token>.new/<token>` and `rename` it to `state.lock`, which
//   fails while a lock is there (non-empty directory on POSIX, any directory
//   on Windows), so a held lock is never empty. Removing it, by its holder or
//   by a waiter breaking a stale one: `rename` the token file `<token>` out
//   (atomic, one winner, and it only matches that exact holder), then
//   `rmdir`, which can only remove an empty directory and so never a lock
//   someone has freshly taken. A holder whose token is gone (its lock was
//   broken) touches nothing on release. Staleness is the token file's mtime.
//   An empty `state.lock` (a remover between its two steps, or one that
//   crashed there) is simply `rmdir`ed. Only rename/rmdir/unlink semantics,
//   the same on POSIX and Windows; no native dependency.
// - Alternatives considered: a token inside a lock FILE, renamed aside to
//   break it and checked afterwards, rejected because a waiter that renames a
//   fresh lock by mistake must put it back, and that restore can itself
//   clobber a third waiter's lock; a second "breaker" lock serializing
//   breaks, rejected because that lock needs stale-breaking in turn.
// - Compatibility: the name stays `state.lock`, so an older webveil (lock
//   FILE, `wx`) and this one still exclude each other. A stale lock file left
//   by an older webveil is broken with `unlink`, which never removes a
//   directory, so it too cannot take out a lock taken meanwhile.
// - A process that crashes while taking or removing a lock can leave a
//   `state.lock.<token>.new` or `.gone` entry behind in the partition. They
//   are inert (never read) and go with the partition on clear; not swept.
// - `withLock` is exported for its tests only (with `LockHooks` seams to force
//   an interleaving); it is not part of the package's public surface.
// - Expiry is checked on every read with this store's clock; an expired entry
//   is not returned and is pruned from the file under the lock.
// - An unreadable (non-JSON) state file reads as empty and is overwritten on
//   the next write: state is a cache, losing it only costs a fresh session.
// - The root follows `XDG_STATE_HOME` from the environment the process runs
//   in (not the config layers), like any XDG tool.
//
// Recorded decisions (task searchcast-fallback-and-guard):
// - A persistent searchcast browser profile is `<partition>/browser-profile`,
//   so it inherits the partition's identity: no setting can point two
//   identities at one profile.
// - Its idle clock is the mtime of `<partition>/browser-profile.used`, touched
//   on every search of the identity (not only browser ones: the partition's
//   idleness, as the task says). A profile with no marker has an unknown age
//   and counts as idle. Alternative considered: the profile directory's own
//   mtime, rejected because Chromium rewrites files inside it without
//   necessarily touching the directory entry, so it is no use-clock.
//
// Recorded decisions (task webveil-installs-and-tunables; keys: config.ts
// `searchcast.state`, rules: tunables.ts):
// - LOCK_STALE_MS and LOCK_WAIT_MS are the defaults of `searchcast.state.
//   lockStaleMs` and `lockWaitMs`, handed to `createStateStore` (and so to
//   `withLock`) by the backend. `webveil state clear` uses the current
//   identity's values; `--all` has no single identity, so it uses the
//   defaults.
// - `searchcast.state.persist: false` is not handled here: the backend then
//   hands searchcast its in-memory store and this module is never called for
//   that identity (backends/searchcast.ts).

import {randomBytes} from 'node:crypto';
import {
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	rmdir,
	stat,
	unlink,
	utimes,
	writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {JsonValue, StateStore} from 'searchcast';

const IDENTITY = /^[0-9a-f]{64}$/;
const STATE_FILE = 'state.json';
const LOCK_FILE = 'state.lock';
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 30_000;

interface Entry {
	value: JsonValue;
	expires?: number;
}
type Entries = Record<string, Entry>;

/** `$XDG_STATE_HOME/webveil`, falling back to `<home>/.local/state/webveil`. */
export function stateRoot(
	env: Record<string, string | undefined> = process.env,
	homeDir = homedir(),
): string {
	return join(
		env.XDG_STATE_HOME || join(homeDir, '.local', 'state'),
		'webveil',
	);
}

/** The partition directory of an identity key (a 64-hex hash, nothing else). */
export function partitionDir(identity: string, root = stateRoot()): string {
	if (!IDENTITY.test(identity))
		throw new Error(`webveil: invalid state identity '${identity}'`);
	return join(root, identity);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Make root and partition, both 0700 (an existing one is tightened). */
async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, {recursive: true, mode: 0o700});
	await chmod(join(dir, '..'), 0o700);
	await chmod(dir, 0o700);
}

/** The lock's timing (`searchcast.state.lockStaleMs`/`lockWaitMs`). */
export interface LockTiming {
	/** A lock older than this is broken. Default LOCK_STALE_MS (10 s). */
	staleMs?: number;
	/** Waiting longer than this is an error. Default LOCK_WAIT_MS (30 s). */
	waitMs?: number;
}

/** Test seams of `withLock`, to force an interleaving; nothing else sets them. */
export interface LockHooks {
	/** Awaited after judging the lock stale, before breaking it. */
	onStale?: () => Promise<void>;
	/** Called each time the lock is found held and fresh, before waiting. */
	onWait?: () => void;
}

/** Rename errors meaning "the lock path is taken" (POSIX and Windows). */
const TAKEN = new Set([
	'EEXIST',
	'ENOTEMPTY',
	'ENOTDIR',
	'EPERM',
	'EACCES',
	'EBUSY',
]);
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

/**
 * Remove the lock directory `lock` if it holds exactly `token`: move the token
 * out (atomic, and only possible while `token` is still the holder), then
 * `rmdir`, which only ever removes an empty directory, never a held lock.
 * False when `token` no longer holds the lock (nothing is touched).
 */
async function release(lock: string, token: string, own: string) {
	const gone = `${lock}.${own}.gone`;
	try {
		await rename(join(lock, token), gone);
	} catch (error) {
		if (codeOf(error) === 'ENOENT') return false;
		throw error;
	}
	await rm(gone, {force: true});
	await rmdir(lock).catch(() => {}); // gone already, or a new lock in place
	return true;
}

/**
 * Run `fn` holding the partition's lock (see the decisions above; the takeover
 * design is recorded there under task state-lock-stale-takeover-race).
 */
export async function withLock<T>(
	dir: string,
	fn: () => Promise<T>,
	hooks: LockHooks = {},
	{staleMs = LOCK_STALE_MS, waitMs = LOCK_WAIT_MS}: LockTiming = {},
): Promise<T> {
	const lock = join(dir, LOCK_FILE);
	const own = `${process.pid}-${randomBytes(8).toString('hex')}`;
	const next = `${lock}.${own}.new`;
	const start = Date.now();
	try {
		for (;;) {
			if (Date.now() - start > waitMs)
				throw new Error(`webveil: state lock ${lock} held too long`);
			await ensureDir(dir);
			await mkdir(next, {recursive: true, mode: 0o700});
			await writeFile(join(next, own), '', {mode: 0o600}); // fresh mtime
			try {
				await rename(next, lock);
				break;
			} catch (error) {
				if (codeOf(error) === 'ENOENT') continue; // partition removed meanwhile
				if (!TAKEN.has(codeOf(error) ?? '')) throw error;
			}
			const held = await readdir(lock).catch((error: unknown) => {
				if (codeOf(error) === 'ENOTDIR') return null;
				if (codeOf(error) === 'ENOENT') return [];
				throw error;
			});
			if (held === null) {
				// A lock file from an older webveil: `unlink` never removes a
				// directory, so it cannot take out a lock taken meanwhile.
				const age = await stat(lock).then(
					(s) => Date.now() - s.mtimeMs,
					() => 0,
				);
				if (age > staleMs) {
					await hooks.onStale?.();
					await unlink(lock).catch(() => {});
					continue;
				}
			} else if (held.length === 0) {
				// Released or broken, not yet removed (or a remover crashed).
				await rmdir(lock).catch(() => {});
				continue;
			} else {
				const token = held[0]!;
				const age = await stat(join(lock, token)).then(
					(s) => Date.now() - s.mtimeMs,
					() => 0,
				);
				if (age > staleMs) {
					await hooks.onStale?.();
					await release(lock, token, own);
					continue;
				}
			}
			hooks.onWait?.();
			await sleep(5 + Math.random() * 20);
		}
	} finally {
		await rm(next, {recursive: true, force: true});
	}
	try {
		return await fn();
	} finally {
		await release(lock, own, own);
	}
}

async function load(file: string): Promise<Entries> {
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw error;
	}
	try {
		const entries = (JSON.parse(text) as {entries?: unknown}).entries;
		return entries && typeof entries === 'object' ? (entries as Entries) : {};
	} catch {
		return {};
	}
}

async function save(file: string, entries: Entries): Promise<void> {
	const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	await writeFile(temp, JSON.stringify({version: 1, entries}), {mode: 0o600});
	await rename(temp, file);
}

export interface StateStoreOptions {
	/** The clock expiry is measured with, in ms since the epoch. */
	now?: () => number;
	/** The partition lock's timing. */
	lock?: LockTiming;
}

/** searchcast's `StateStore` over the partition directory `dir`. */
export function createStateStore(
	dir: string,
	options: StateStoreOptions = {},
): StateStore {
	const now = options.now ?? Date.now;
	const file = join(dir, STATE_FILE);
	const expired = (e: Entry) => e.expires !== undefined && e.expires <= now();
	/** Load under the lock, drop expired entries, apply `change`, save. */
	const update = (change: (entries: Entries) => boolean) =>
		withLock(
			dir,
			async () => {
				const entries = await load(file);
				let dirty = false;
				for (const [key, e] of Object.entries(entries))
					if (expired(e)) dirty = delete entries[key];
				if (change(entries) || dirty) await save(file, entries);
			},
			{},
			options.lock,
		);
	return {
		async get(key) {
			const entry = (await load(file))[key];
			if (!entry) return undefined;
			if (!expired(entry)) return entry.value;
			await update(() => false);
			return undefined;
		},
		async set(key, value, {ttlMs} = {}) {
			await update((entries) => {
				entries[key] = {
					value: JSON.parse(JSON.stringify(value)) as JsonValue,
					...(ttlMs !== undefined && {expires: now() + ttlMs}),
				};
				return true;
			});
		},
		async delete(key) {
			await update((entries) => key in entries && delete entries[key]);
		},
	};
}

const PROFILE_DIR = 'browser-profile';
const PROFILE_USED = 'browser-profile.used';

/** The persistent browser profile of a partition directory. */
export function profileDir(partition: string): string {
	return join(partition, PROFILE_DIR);
}

/**
 * True when the partition has been idle longer than `idleMs` (see the
 * decisions above), so its browser profile must go before the next start.
 */
export async function isProfileIdle(
	partition: string,
	idleMs: number,
	now = Date.now(),
): Promise<boolean> {
	const used = await stat(join(partition, PROFILE_USED)).catch(() => undefined);
	return !used || now - used.mtimeMs > idleMs;
}

/** Delete the partition's browser profile (its browser must be closed). */
export async function deleteProfile(partition: string): Promise<void> {
	await rm(profileDir(partition), {recursive: true, force: true});
}

/** Mark the partition as used now (its browser profile's idle clock). */
export async function touchProfile(
	partition: string,
	now = Date.now(),
): Promise<void> {
	await ensureDir(partition);
	const marker = join(partition, PROFILE_USED);
	await writeFile(marker, '', {mode: 0o600});
	await utimes(marker, now / 1000, now / 1000);
}

/**
 * Remove the partition of `identity`, or with none every partition under
 * `root`. Returns the identity keys removed.
 */
export async function clearState(
	root: string,
	identity?: string,
	lock: LockTiming = {},
): Promise<string[]> {
	const ids =
		identity !== undefined
			? [identity]
			: (await readdir(root).catch(() => [])).filter((n) => IDENTITY.test(n));
	const cleared: string[] = [];
	for (const id of ids) {
		const dir = partitionDir(id, root);
		if (!(await stat(dir).catch(() => undefined))) continue;
		await withLock(
			dir,
			() => rm(dir, {recursive: true, force: true}),
			{},
			lock,
		);
		cleared.push(id);
	}
	return cleared;
}
