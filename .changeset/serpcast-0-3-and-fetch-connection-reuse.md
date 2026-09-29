---
'webveil': minor
---

Require `serpcast` `^0.3.0` (`sec-fetch-site`, `referer`, `origin` and `sec-fetch-storage-access` now follow Chromium for same-site and cross-site subresources). `web_fetch` over the serpcast transport now reuses connections across fetches of the same fetch-hop egress (about 0.09 s instead of about 0.5 s per fetch over Tor): a small pool of sessions per egress, each fetch taking an idle one with its cookies cleared, never sharing a busy one, so no cookie is carried from one fetch to another. Idle sessions close after 10 minutes, or when webveil exits. A site sees repeated fetches to it on one TLS connection (see the README fetch section).
