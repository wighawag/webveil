import {describe, expect, it, vi} from 'vitest';
import {
	assertPublicUrl,
	guardEgressFetch,
	isPrivateIp,
	SsrfError,
} from '../src/core/security.js';
import type {Config} from '../src/core/config.js';
import type {EgressFetch} from '../src/core/egress.js';

function cfg(egress: Config['egress']): Config {
	return {
		backend: 'searxng',
		baseUrl: 'http://127.0.0.1:8080',
		egress,
		fetchSize: 'm',
	};
}

describe('isPrivateIp (range classification)', () => {
	it('flags IPv4 private / loopback / link-local / CGNAT / reserved ranges', () => {
		for (const ip of [
			'0.0.0.0',
			'10.0.0.1',
			'10.255.255.255',
			'127.0.0.1',
			'169.254.169.254', // cloud metadata
			'172.16.0.1',
			'172.31.255.255',
			'192.168.1.1',
			'100.64.0.1', // CGNAT
			'192.0.2.1', // TEST-NET-1
			'198.18.0.1', // benchmark
			'198.51.100.1', // TEST-NET-2
			'203.0.113.1', // TEST-NET-3
			'224.0.0.1', // multicast
			'240.0.0.1', // reserved
		])
			expect(isPrivateIp(ip), ip).toBe(true);
	});

	it('lets public IPv4 through', () => {
		for (const ip of [
			'8.8.8.8',
			'1.1.1.1',
			'93.184.216.34',
			'172.15.0.1',
			'172.32.0.1',
		])
			expect(isPrivateIp(ip), ip).toBe(false);
	});

	it('flags IPv6 loopback / ULA / link-local / multicast (default-deny)', () => {
		for (const ip of [
			'::1',
			'::',
			'fc00::1',
			'fd00::1',
			'fe80::1',
			'ff02::1',
			'::ffff:127.0.0.1',
		])
			expect(isPrivateIp(ip), ip).toBe(true);
	});

	it('lets global-unicast IPv6 through', () => {
		for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888'])
			expect(isPrivateIp(ip), ip).toBe(false);
	});

	it('returns false for non-IP strings (hostnames are resolved elsewhere)', () => {
		expect(isPrivateIp('example.com')).toBe(false);
	});
});

describe('assertPublicUrl (direct egress blocks, proxy egress relaxes)', () => {
	it('BLOCKS a literal private IP on direct egress', async () => {
		await expect(
			assertPublicUrl('http://127.0.0.1/x', cfg({mode: 'direct'})),
		).rejects.toBeInstanceOf(SsrfError);
		await expect(
			assertPublicUrl(
				'http://169.254.169.254/latest/meta-data',
				cfg({mode: 'direct'}),
			),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it('ALLOWS the SAME private IP under http proxy egress', async () => {
		await expect(
			assertPublicUrl(
				'http://127.0.0.1/x',
				cfg({mode: 'http', url: 'http://127.0.0.1:8118'}),
			),
		).resolves.toBeUndefined();
	});

	it('ALLOWS the SAME private IP under socks5 proxy egress (Tor/Mullvad need it)', async () => {
		await expect(
			assertPublicUrl(
				'http://10.64.0.1/x',
				cfg({mode: 'socks5', url: 'socks5://127.0.0.1:9050'}),
			),
		).resolves.toBeUndefined();
	});

	it('allows a public literal IP on direct egress', async () => {
		await expect(
			assertPublicUrl('https://1.1.1.1/', cfg({mode: 'direct'})),
		).resolves.toBeUndefined();
	});

	it('blocks a hostname that RESOLVES to a private IP on direct egress', async () => {
		// localhost resolves to 127.0.0.1 / ::1 (a name pointing at a private IP).
		await expect(
			assertPublicUrl('http://localhost/admin', cfg({mode: 'direct'})),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it('does NOT resolve hostnames locally under proxy egress (no DNS leak)', async () => {
		// Under a proxy the guard relaxes ENTIRELY: a name that would resolve to a
		// private IP must still pass without a local lookup (the proxy owns DNS).
		await expect(
			assertPublicUrl(
				'http://localhost/admin',
				cfg({mode: 'socks5', url: 'socks5://127.0.0.1:9050'}),
			),
		).resolves.toBeUndefined();
	});

	it('rejects a malformed url on direct egress', async () => {
		await expect(
			assertPublicUrl('not a url', cfg({mode: 'direct'})),
		).rejects.toBeInstanceOf(SsrfError);
	});
});

describe('guardEgressFetch (wraps the egress fetch; covers distilly requests)', () => {
	function spyFetch(): EgressFetch {
		return vi.fn(async () => new Response('ok')) as unknown as EgressFetch;
	}

	it('BLOCKS a private-IP request on direct egress, never calling the inner fetch', async () => {
		const inner = spyFetch();
		const guarded = guardEgressFetch(inner, cfg({mode: 'direct'}));
		await expect(guarded('http://127.0.0.1/x')).rejects.toBeInstanceOf(
			SsrfError,
		);
		expect(inner).not.toHaveBeenCalled();
	});

	it('ALLOWS a private-IP request under proxy egress, delegating to the inner fetch', async () => {
		const inner = spyFetch();
		const guarded = guardEgressFetch(
			inner,
			cfg({mode: 'http', url: 'http://127.0.0.1:8118'}),
		);
		const res = await guarded('http://10.64.0.1/x');
		expect(res.status).toBe(200);
		expect(inner).toHaveBeenCalledTimes(1);
	});

	it('checks the URL of a Request object too (distilly may pass either)', async () => {
		const inner = spyFetch();
		const guarded = guardEgressFetch(inner, cfg({mode: 'direct'}));
		await expect(
			guarded(new Request('http://192.168.0.1/x')),
		).rejects.toBeInstanceOf(SsrfError);
		expect(inner).not.toHaveBeenCalled();
	});

	it('passes a public-host request through to the inner fetch on direct egress', async () => {
		const inner = spyFetch();
		const guarded = guardEgressFetch(inner, cfg({mode: 'direct'}));
		const res = await guarded('https://1.1.1.1/');
		expect(res.status).toBe(200);
		expect(inner).toHaveBeenCalledTimes(1);
	});
});
