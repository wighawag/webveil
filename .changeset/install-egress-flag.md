---
'webveil': minor
---

`install-libcurl` and `install-recipes` take `--egress`: download through the egress webveil already has configured (resolved as for `search`, SOCKS as `socks5h://`), with its credentials used but never printed. It takes `egress`, or `fetchEgress` when only that hop is a proxy; with every hop direct it is a direct download. An egress the downloader cannot use fails before any request. `--egress`, `--proxy` and `--direct` are mutually exclusive (exit 2), and the refusal under a proxy egress now offers `--egress` first.
