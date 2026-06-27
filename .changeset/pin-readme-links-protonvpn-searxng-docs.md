---
'webveil': patch
'pi-webveil': patch
---

Fix dead documentation links on npmjs.com and expand egress/SearXNG docs.

The publish-time asset copy (`scripts/copy-publish-assets.mjs`) now rewrites the
published README's repo-relative links to files that are NOT in the tarball
(`work/`, `docs/`, `packages/`, `CONTEXT.md`, `COPYRIGHT`) into absolute GitHub
URLs, pinned to the per-package release tag (`name@version`, the tag Changesets
pushes), so they point at the exact published tree instead of a moving `main`.
The source README keeps repo-relative links (correct on GitHub); shipped assets
(`README.md`, `LICENSE`) stay relative.

README also gains a "ProtonVPN (via wireproxy)" and "Other SOCKS5 providers"
section under Anonymous egress, the Quick start is trimmed to the minimal happy
path, and the detailed SearXNG install matter (uwsgi vs `http-socket`, Unix
sockets, reverse proxy, limiter) moves into `docs/searxng-setup.md`. The egress
docs now make explicit that `socks5` is for a remote backend or `web_fetch`, and
that a local SearXNG must instead carry the proxy on its own `outgoing.proxies`
(webveil stays `direct`), matching the fail-loud guard.
