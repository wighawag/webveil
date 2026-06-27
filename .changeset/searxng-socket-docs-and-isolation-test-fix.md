---
'webveil': patch
---

Fix a brittle isolation test and correct the SearXNG Unix-socket docs.

- **Test fix:** the `unix:` baseUrl isolation test no longer asserts that a real install
  path (`/usr/local/searxng/run/socket`) is absent — that assertion fails on any machine
  where SearXNG is actually installed (webveil's target users). Isolation is now proven over
  the test's own temp fixture only (`readdirSync(dir)` holds exactly the test socket).
- **Docs:** the README "Other SearXNG install options" section and the
  `searxng-install-topology` finding now state that the install-script default socket speaks
  the **uwsgi protocol, not HTTP**, so a `unix:` baseUrl needs the socket switched to
  `http-socket =` (or a reverse proxy) first; they also document the required limiter +
  JSON-format `settings.yml` changes (the `429` fix) and how a Caddy/nginx browser frontend
  can coexist with `http-socket`. webveil stays HTTP-only by design (no uwsgi-protocol
  support).
