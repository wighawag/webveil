---
'webveil': minor
'pi-webveil': minor
---

New `serpcast` backend: keyless web search with no SearXNG, where webveil's `egress` is the search egress.

- **`backend: "serpcast"`** runs declarative recipes through the [serpcast](https://github.com/wighawag/serpcast) engine chain over libcurl-impersonate. Configure it in a `serpcast` section: `engines` (engine names, tried in order), `recipes` (recipe files or directories), `libcurlPath`, `sessionIdleMs`, `cooldownMs`; env `WEBVEIL_SERPCAST_LIBCURL_PATH`, `WEBVEIL_SERPCAST_SESSION_IDLE_MS`, `WEBVEIL_SERPCAST_COOLDOWN_MS`.
- **Egress is the search egress.** The backend-hop `egress` becomes serpcast's proxy: `socks5://`, `socks://` and `socks5h://` all reach it as `socks5h://` (DNS at the proxy), `http` passes through, `direct` means no proxy. The loopback-`baseUrl` guard does not apply to this backend.
- **Strict impersonation, always.** Without a working libcurl-impersonate the search fails with the fix in the message (`npx serpcast install-libcurl`, or set `serpcast.libcurlPath`). There is no setting to turn strict mode off.
- **`serpcast.libcurlPath` is an executable setting**: refused from a project `webveil.json`, used from the global config or env.
- **Failures surface.** Engines that failed before the answering one appear in `unresponsiveEngines`; when every engine fails, the search is an error listing each engine's failure, never an empty list.
- **One serpcast instance per identity** (backend-hop egress plus the resolved `serpcast` section), kept across searches in the MCP server and pi extension so cooldowns and sessions carry over; `closeBackends()` releases it at process level (after a one-shot CLI command, when the MCP server's stdin ends or it is signalled, and on pi's `session_shutdown`).
