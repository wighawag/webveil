import {it, describe, expect} from 'vitest';
import piWebveil from '../src/index.js';

describe('pi-webveil', () => {
	it('exports a default extension factory (not yet implemented)', () => {
		expect(typeof piWebveil).toBe('function');
		expect(() => piWebveil({})).toThrow(/not implemented/);
	});
});
