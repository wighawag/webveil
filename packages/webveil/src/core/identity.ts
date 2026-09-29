// identity: the key naming one search identity, so per-identity state (the
// cached serpcast instance today, its on-disk state store later) never
// crosses identities (docs/adr/0004).
//
// Recorded decision (task serpcast-backend-basic): the key is the sha256 of a
// canonical JSON (keys sorted, undefined dropped) of the backend-hop `egress`
// object and the backend's WHOLE resolved section (paths made absolute). The
// whole section, so settings added later join the identity without touching
// this; resolved paths, so the same relative path in two projects is two
// identities. Only a hash leaves this module: no URL or credential in a path.
// Alternative considered: a hand-picked subset (proxy URL + library path),
// rejected because each new setting would have to remember to join it.

import {createHash} from 'node:crypto';
import type {Egress} from './config.js';

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	const entries = Object.entries(value).filter(([, v]) => v !== undefined);
	entries.sort(([a], [b]) => (a < b ? -1 : 1));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)}}`;
}

/** The identity key (64 hex chars) of an egress and a resolved section. */
export function identityKey(egress: Egress, section: object): string {
	const identity = canonical({egress, section});
	return createHash('sha256').update(identity).digest('hex');
}
