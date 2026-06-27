---
'pi-webveil': patch
---

Fix a TUI crash (`TypeError: child.render is not a function`) when displaying `web_search` / `web_fetch` results. The tools defined `renderResult` to return a `string[]`, but pi's extension API expects a `Component`. The bad value was added as a render child and crashed pi's render pass, taking down the whole TUI. The custom `renderResult` is removed; pi now uses its built-in text renderer on the tool result's text content, which is the same compact output these tools already produce.
