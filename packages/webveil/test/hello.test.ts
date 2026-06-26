import {it, describe, expect} from 'vitest';
import {search, fetch} from '../src/index.js';

describe('webveil core', () => {
	it('exposes search (not yet implemented)', async () => {
		await expect(search('hello')).rejects.toThrow(/not implemented/);
	});
	it('exposes fetch (not yet implemented)', async () => {
		await expect(fetch('https://example.com')).rejects.toThrow(
			/not implemented/,
		);
	});
});
