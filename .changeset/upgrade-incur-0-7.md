---
'webveil': minor
---

webveil now runs on incur 0.7.1 (was 0.4.10). The commands, `--help`, `--llms`, `skills` and `webveil --mcp` work as before.

- **`--mcp` serves the same tools**: `search`, `fetch` and `state_clear`. incur now defaults to progressive tool discovery (`search_tools`, `get_tool_details`, `call_read_tool`, `call_write_tool`); webveil keeps each command as its own tool, so configured MCP clients need no change.
- **No update check.** incur now checks the npm registry for a newer version, once a day, from a detached process, outside the configured egress. webveil turns that off: it makes no request you did not route. incur's new `--update` global flag is listed in `--help`; it runs `npm install --global webveil@latest`, only when you type it.
- **No direct `@modelcontextprotocol/server` dependency any more.** incur 0.7 loads the SDK's `./stdio` entry itself and pins the SDK version it needs (`2.0.0-alpha.4`), so the `2.0.0-alpha.2` pin webveil carried to keep `--mcp` working is gone.
- The first line of `--help` still separates the name from the description with an em dash: incur writes it and has no option to change it.
