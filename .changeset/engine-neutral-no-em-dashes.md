---
'webveil': patch
'pi-webveil': patch
---

Text cleanup with no behaviour change. Error messages, the pi extension's degradation warning (now `[warning] search degraded (unresponsive engines: a, b). ...`), source comments and the docs no longer use em dashes, and examples name no real search engine except Mwmbl and Marginalia: they use placeholders such as `engine-a`. A repo test (`scripts/text-rules.mjs`) now fails on either, outside `work/` and the changelogs.
