---
title: egress accepts socks5h:// (and socks://) but ignores the scheme — silent no-op
slug: socks5h-scheme-accepted-but-ignored
---

## What was observed

`socksFromUrl` in `packages/webveil/src/core/egress.ts` accepts three schemes —
`socks5://`, `socks://`, and `socks5h://` — then unconditionally builds
`socksDispatcher({ type: 5, ... })` with NO branch on the scheme. So the `5` vs `5h`
distinction (local vs remote DNS resolution, the single most-cited SOCKS anonymity knob)
is silently dropped.

```
if (protocol !== 'socks5' && protocol !== 'socks' && protocol !== 'socks5h')
    throw ...
return socksDispatcher({ type: 5, host, port, ... });
```

## Why it is NOT a leak (but still a defect)

DNS is already resolved REMOTELY by default in this stack (the `socks` library sends a
domain-name address to the proxy; undici confirms "all DNS resolution happens on the proxy
server"). So behaviour is effectively `socks5h` regardless of the scheme written — there is
no DNS leak (see finding `socks5-egress-behaviour-in-webveil`).

The defect is the MISLEADING contract: a user who writes `socks5://` expecting LOCAL DNS,
or who writes `socks5h://` expecting it to be ENFORCED/required, gets the same behaviour
either way with no signal that the scheme was cosmetic. The URL says one thing; the code
does another, silently.

## Suggested fix (small; pick one)

- **Document-only:** state in the egress docs that DNS is always resolved at the proxy
  (remote), so the scheme is cosmetic — and keep accepting all three for ergonomics. (The
  README anonymous-egress section is the place; it already implies remote DNS via the SSRF
  note.)
- **Normalise + comment:** keep accepting all three but add a code comment that `type: 5`
  with the `socks` library is always remote-DNS, so `socks5`/`socks5h` are equivalent here
  on purpose. Cheapest honest fix.
- **Stricter (probably overkill):** reject `socks5h://` as an unsupported spelling and only
  accept `socks5://`/`socks://`. Rejected as user-hostile — `socks5h` is a reasonable thing
  to type and it does the right thing.

Recommendation: the normalise+comment option (code) plus one README line. Low priority —
behaviour is correct; only the contract clarity is off. Capture-only for now; reconcile
when next touching egress.
