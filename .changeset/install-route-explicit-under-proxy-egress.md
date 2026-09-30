---
'webveil': minor
---

`webveil install-libcurl` and `webveil install-recipes` no longer guess a download's route when the configured egress is a proxy. With `egress` or `fetchEgress` set to `http` or `socks5` (any config layer or env), they refuse with exit 2 before any request until you pass `--proxy <url>` or the new `--direct` flag, since a direct download would tell the host that your own IP installed it. The error names the configured egress (credentials as `***`) and shows the matching `--proxy` value (SOCKS as `socks5h://`). With a direct egress nothing changes. `--proxy` with `--direct` is a usage error; `install-recipes` of a local file needs neither.
