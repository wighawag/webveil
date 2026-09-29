---
'webveil': patch
---

Declare `searchcast` (`>=0.1.1`) as an optional peer dependency. It is still not installed with webveil: install it next to webveil for library-mode browser engines. Declaring it lets a strict pnpm layout expose it to webveil.
