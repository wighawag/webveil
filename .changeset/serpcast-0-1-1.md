---
'webveil': patch
---

Require `serpcast` `^0.1.1`. serpcast 0.1.0's transport deadlocked `process.exit()` while a request was in flight, so a failed or timed-out serpcast search in the webveil CLI hung forever instead of exiting; 0.1.1 fixes it, and the CLI now exits right after the timeout. The README also gains an "On NixOS" section and a note on Marginalia's shared API key.
