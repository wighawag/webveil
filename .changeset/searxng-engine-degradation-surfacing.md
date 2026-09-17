---
'webveil': minor
'pi-webveil': minor
---

Surface SearXNG engine degradation, from the live "confident garbage" incident (2026-09-16): every curated engine refused or poisoned the instance's direct egress IP, and the one still answering (bing) served HTTP 200 "decoy SERPs" of unrelated results that parse as real ones — so the response carried no degradation signal at all.

The searxng backend now threads the JSON response's `unresponsive_engines` through to callers:

- **Some engines down, others answered** — results are annotated with a new optional `unresponsiveEngines` field on every hit (partial results are still useful, so this does not fail); the CLI/MCP output hoists the flag to a top-level `unresponsiveEngines` field, and the pi extension renders a `[warning] search degraded …` line in the tool text the model reads. A degraded answer never masquerades as a clean one.
- **Zero results + engines unresponsive** — treated as a full outage and fails loud (an error naming the engines) instead of returning a confident empty list; a genuine no-hit query on a healthy instance still returns `[]`.

Honest limit, stated in the docs: webveil **cannot detect junk results** — a decoy SERP is indistinguishable from a real one at this layer. When the surviving engine serves decoys, the response looks clean while being garbage end to end; the fix is egress-level (SearXNG's `outgoing.proxies`), never in webveil.

Docs: a new `docs/searxng-setup.md` troubleshooting section documents the "irrelevant-but-confident results" symptom signature (a flagged egress IP, not a SearXNG bug), per-engine isolation via `curl --unix-socket … "&engines=<name>&format=json"`, and the `outgoing.proxies` fix; the README's "Where does anonymity live?" gains a chained-egress subsection (app → Mullvad WireGuard base → rotating-residential exit → site — `fetchEgress` points at the chain port like any `socks5h://` URL, the local SearXNG hop stays `direct`, and Tor cannot be a chain base since its exit path is fixed to Tor relays).