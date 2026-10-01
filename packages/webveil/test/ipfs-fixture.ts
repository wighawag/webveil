// A minimal, hand-written IPFS content writer for the offline `ipfs://`
// install tests: raw-leaf files, a flat UnixFS directory (dag-pb) and a CAR v1
// holding their blocks, as a trustless gateway would answer
// `GET /ipfs/<cid>?format=car`. Only what those tests need: CIDv1, sha2-256,
// the raw (0x55) and dag-pb (0x70) codecs. Written by hand rather than with
// searchcast's IPFS dependencies, which are not webveil's.

import {createHash} from 'node:crypto';

const RAW = 0x55;
const DAG_PB = 0x70;
const SHA2_256 = 0x12;

/** An unsigned LEB128 varint. */
function varint(n: number): Buffer {
	const out: number[] = [];
	while (n >= 0x80) {
		out.push((n & 0x7f) | 0x80);
		n = Math.floor(n / 0x80);
	}
	out.push(n);
	return Buffer.from(out);
}

/** A content block: its CID's bytes and string, and its data. */
export interface Block {
	cid: Buffer;
	/** The CID as a base32 (`b...`) string, as in an `ipfs://` URL. */
	id: string;
	bytes: Buffer;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(data: Buffer): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of data) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
	return out;
}

function block(codec: number, bytes: Buffer): Block {
	const digest = createHash('sha256').update(bytes).digest();
	const cid = Buffer.concat([
		varint(1),
		varint(codec),
		varint(SHA2_256),
		varint(digest.length),
		digest,
	]);
	return {cid, id: `b${base32(cid)}`, bytes};
}

/** A file as one raw leaf. */
export const rawFile = (content: string | Buffer): Block =>
	block(RAW, Buffer.from(content));

/** A protobuf length-delimited field. */
const field = (tag: number, value: Buffer) =>
	Buffer.concat([Buffer.from([tag]), varint(value.length), value]);

/** A flat UnixFS directory linking each named block (dag-pb: links, then data). */
export function directory(entries: Record<string, Block>): Block {
	const names = Object.keys(entries).sort((a, b) =>
		Buffer.compare(Buffer.from(a), Buffer.from(b)),
	);
	const links = names.map((name) => {
		const child = entries[name]!;
		return field(
			0x12,
			Buffer.concat([
				field(0x0a, child.cid),
				field(0x12, Buffer.from(name)),
				Buffer.from([0x18]),
				varint(child.bytes.length),
			]),
		);
	});
	// UnixFS Data { Type: Directory (1) }
	const data = field(0x0a, Buffer.from([0x08, 0x01]));
	return block(DAG_PB, Buffer.concat([...links, data]));
}

/** A CAR v1 rooted at `root`, holding `blocks` (dag-cbor header written by hand). */
export function car(root: Block, blocks: Block[]): Buffer {
	const link = Buffer.concat([Buffer.from([0x00]), root.cid]);
	const header = Buffer.concat([
		Buffer.from([0xa2]), // map(2), keys in dag-cbor order
		Buffer.from([0x65]),
		Buffer.from('roots'),
		Buffer.from([0x81, 0xd8, 0x2a, 0x58, link.length]), // [tag 42 bytes]
		link,
		Buffer.from([0x67]),
		Buffer.from('version'),
		Buffer.from([0x01]),
	]);
	const parts = [varint(header.length), header];
	for (const b of blocks)
		parts.push(varint(b.cid.length + b.bytes.length), b.cid, b.bytes);
	return Buffer.concat(parts);
}

/**
 * The path a trustless gateway is asked for (searchcast's request). Since
 * searchcast 0.4.1 it asks `dag-scope=entity` first (a file is complete in
 * that answer, a directory's is its listing), then `all` for a directory.
 */
export const carPath = (
	cid: string,
	path = '',
	scope: 'entity' | 'all' = 'entity',
) => `/ipfs/${cid}${path ? `/${path}` : ''}?format=car&dag-scope=${scope}`;
