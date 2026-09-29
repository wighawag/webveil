---
'webveil': patch
---

Security fix: `web_fetch` now runs the SSRF guard on every redirect hop, not only the first url. On `direct` egress (the default) a public page that redirected to a private address (`127.0.0.1`, cloud metadata at `169.254.169.254`, or a hostname resolving to one) was fetched and returned; webveil now follows redirects itself (at most 20, http(s) only) and refuses such a target before it is requested. Legitimate redirect chains and their `web_fetch` output are unchanged, and `http`/`socks5` egress behaves as before (no local DNS).
