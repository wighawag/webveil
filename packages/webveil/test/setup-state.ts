// Isolate persisted state: point XDG_STATE_HOME at a temp dir for the whole
// test file, and assert the real state dir is exactly as it was afterwards.

import {afterAll, expect} from 'vitest';
import {existsSync, mkdtempSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stateRoot} from '../src/core/state.js';

const realRoot = stateRoot(process.env);
/** Each partition of the real root with its mtime (undefined: no root). */
const snapshot = () =>
	existsSync(realRoot)
		? readdirSync(realRoot)
				.sort()
				.map((name) => [name, statSync(join(realRoot, name)).mtimeMs])
		: undefined;
const before = snapshot();
const temp = mkdtempSync(join(tmpdir(), 'webveil-state-'));
process.env.XDG_STATE_HOME = temp;

afterAll(() => {
	rmSync(temp, {recursive: true, force: true});
	expect(snapshot()).toEqual(before);
});
