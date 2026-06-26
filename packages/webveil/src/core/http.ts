// http helper — the proxied `http` handed to backends. fetchJson / fetchText
// apply the egress dispatcher + a per-request timeout + abort. Distinct from the
// egress-bound WHATWG `fetch` (egress.ts), but bound to the SAME dispatcher, so
// a backend physically cannot bypass the configured egress.

import {type Dispatcher, fetch as undiciFetch} from 'undici';
import type {Http, HttpRequestOptions} from './backends/types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

async function request(
	dispatcher: Dispatcher | undefined,
	url: string,
	options: HttpRequestOptions = {},
): Promise<Response> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	if (options.signal)
		options.signal.addEventListener('abort', () => controller.abort(), {
			once: true,
		});
	try {
		const res = await undiciFetch(url, {
			method: options.method,
			headers: options.headers,
			body: options.body,
			signal: controller.signal,
			dispatcher,
		} as never);
		return res as unknown as Response;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Build the proxied http helper over a given dispatcher. Both methods throw on a
 * non-2xx response so a backend never silently consumes an error body.
 */
export function createHttp(dispatcher: Dispatcher | undefined): Http {
	return {
		async fetchJson<T = unknown>(
			url: string,
			options?: HttpRequestOptions,
		): Promise<T> {
			const res = await request(dispatcher, url, options);
			if (!res.ok)
				throw new Error(`http ${res.status} ${res.statusText} for ${url}`);
			return (await res.json()) as T;
		},
		async fetchText(
			url: string,
			options?: HttpRequestOptions,
		): Promise<string> {
			const res = await request(dispatcher, url, options);
			if (!res.ok)
				throw new Error(`http ${res.status} ${res.statusText} for ${url}`);
			return await res.text();
		},
	};
}
