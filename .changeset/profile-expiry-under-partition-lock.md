---
'webveil': patch
'pi-webveil': patch
---

A persistent searchcast browser profile (`searchcast.browser.persistProfile`) is now safe with several webveil processes of the same identity (parallel CLI calls, or the CLI next to a running MCP server or pi extension).

- **One owner at a time.** The process that searches with the profile first owns it (its pid in `<identity>/browser-profile.owner`) until it closes. Another process of the same identity no longer fails on Chromium's profile lock: it searches with a temporary profile of its own, deleted when it ends, and says so once (on stderr; in pi, as a tool warning).
- **No deletion under a running browser.** The idle check, the delete and the use mark now run as one step under the identity's state lock, and a profile owned by another live process is never deleted, however long it was idle. A crashed owner holds nothing: its claim is dropped at the next search.
- The default (a temporary profile per process) is unchanged.
