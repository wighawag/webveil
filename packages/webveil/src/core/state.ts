// state: serpcast's `StateStore` on disk, one partition per identity
// (identity.ts), so the one-shot CLI keeps sessions and cooldowns between
// calls and no state ever crosses identities (docs/adr/0004).
//
// Layout: `$XDG_STATE_HOME/webveil/<identity key>/state.json` (default
// `~/.local/state/webveil/`). The partition directory is the identity's home
// for anything else it keeps on disk (the searchcast browser profile). Only the
// hash appears in a path; store keys live inside the file, never as names.
//
// Recorded decisions (task identity-partitioned-state-store):
// - One JSON file per partition, rewritten whole: serpcast keeps a handful of
//   small keys, and a single file makes "both writes applied" a plain
//   read-modify-write under the lock. Alternative: a file per key (names
//   encoded), rejected as more files and more locking for no gain.
// - Lock: an exclusive-create (`wx`) `state.lock` in the partition, held only
//   around each read-modify-write; the write itself is a temp file renamed
//   over `state.json`, so readers never take the lock and never see a partial
//   file. A lock older than LOCK_STALE_MS (a crashed writer) is broken; past
//   LOCK_WAIT_MS waiting is an error. Alternative: flock(2), rejected because
//   Node has no portable binding without a native dependency.
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

import {randomBytes} from 'node:crypto';
import {
	chmod,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	utimes,
	writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {JsonValue, StateStore} from 'serpcast';

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

/** Run `fn` holding the partition's lock (see the decisions above). */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
	const lock = join(dir, LOCK_FILE);
	const start = Date.now();
	for (;;) {
		await ensureDir(dir);
		try {
			await (await open(lock, 'wx', 0o600)).close();
			break;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') continue; // partition removed meanwhile
			if (code !== 'EEXIST') throw error;
		}
		const age = await stat(lock).then(
			(s) => Date.now() - s.mtimeMs,
			() => 0,
		);
		if (age > LOCK_STALE_MS) await rm(lock, {force: true});
		else if (Date.now() - start > LOCK_WAIT_MS)
			throw new Error(`webveil: state lock ${lock} held too long`);
		else await sleep(5 + Math.random() * 20);
	}
	try {
		return await fn();
	} finally {
		await rm(lock, {force: true});
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
}

/** serpcast's `StateStore` over the partition directory `dir`. */
export function createStateStore(
	dir: string,
	options: StateStoreOptions = {},
): StateStore {
	const now = options.now ?? Date.now;
	const file = join(dir, STATE_FILE);
	const expired = (e: Entry) => e.expires !== undefined && e.expires <= now();
	/** Load under the lock, drop expired entries, apply `change`, save. */
	const update = (change: (entries: Entries) => boolean) =>
		withLock(dir, async () => {
			const entries = await load(file);
			let dirty = false;
			for (const [key, e] of Object.entries(entries))
				if (expired(e)) dirty = delete entries[key];
			if (change(entries) || dirty) await save(file, entries);
		});
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
): Promise<string[]> {
	const ids =
		identity !== undefined
			? [identity]
			: (await readdir(root).catch(() => [])).filter((n) => IDENTITY.test(n));
	const cleared: string[] = [];
	for (const id of ids) {
		const dir = partitionDir(id, root);
		if (!(await stat(dir).catch(() => undefined))) continue;
		await withLock(dir, () => rm(dir, {recursive: true, force: true}));
		cleared.push(id);
	}
	return cleared;
}
