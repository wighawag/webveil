import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		// Every test file gets a temp XDG_STATE_HOME, so no test (the serpcast
		// ones included) ever writes the real ~/.local/state/webveil.
		setupFiles: ['test/setup-state.ts'],
	},
});
