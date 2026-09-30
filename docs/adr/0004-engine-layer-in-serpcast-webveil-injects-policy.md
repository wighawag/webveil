# The engine layer lives in serpcast; webveil injects egress, per-identity state and trust

> Superseded in naming only by [ADR 0005](0005-serpcast-renamed-searchcast.md): read "serpcast" here as searchcast (the library, the backend and its config section); the decision itself stands.

## Status

accepted

Keyless search without SearXNG (recipes over HTTP with a browser-grade fingerprint, an engine chain, a searchcast browser fallback) is built as a separate, policy-free library, serpcast, which webveil uses as the `serpcast` backend, the same mechanism/policy split as distilly (ADR 0001). webveil keeps the privacy policy: its backend-hop egress becomes serpcast's proxy (so with this backend webveil's egress really is the search egress), it always runs serpcast in strict impersonation mode, it persists sessions and cooldowns on disk partitioned per identity (resolved egress plus backend config, hashed) with idle expiry enforced on read, because replaying a session obtained on one egress over another links the two identities, and it accepts executable configuration (code recipe paths, the `custom` backend command, the libcurl-impersonate library path, searchcast's chrome and xvfb paths and chrome args) only from env or the global config, never from a project `webveil.json`, because config is discovered by walking up from the cwd and a cloned repository must never be able to make webveil run code. To make that enforceable per key, config sections merge key by key across layers and provenance is kept per key path. The egress handed to serpcast always resolves DNS at the proxy (`socks5h`), matching webveil's own SOCKS path, and a browser profile is never shared across identities.

## Considered Options

- **Build the engine layer inside webveil**: rejected; it is useful without anonymity (reuse), carries a native dependency webveil's other paths do not need, and would blow webveil's size budget.
- **A separate non-anonymous pi extension on top of serpcast**: rejected; webveil with `egress: direct` already covers that use (for example under anonctl, where the account's traffic is forced), and two extensions registering `web_search`/`web_fetch` would conflict and duplicate the fetch SSRF guard.

## Consequences

- A non-direct egress combined with an external searchcast endpoint webveil cannot proxy is refused, like the loopback-SearXNG guard (ADR 0003).
- `web_fetch` can also use the impersonated transport: `fetchTransport` (`plain` | `serpcast`), which defaults to `serpcast` when the backend is `serpcast` (owner decision 2026-09-29, `core/fetch-transport.ts`). The serpcast fetch uses the fetch-hop egress, strict impersonation with no fallback to `plain`, and the SSRF guard on every redirect hop.
