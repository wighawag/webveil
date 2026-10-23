---
'webveil': patch
'pi-webveil': patch
---

`webveil install-recipes` and `webveil install-libcurl` failures now have real error codes instead of incur's `UNKNOWN`: `NOT_A_RECIPE_SET` (exit 1) when an `ipfs://` directory cannot be a recipe set (a release folder's root, say), `INSTALL_FAILED` (exit 1) for any other failed install; usage errors keep their codes and exit 2. The not-a-set refusal's message is now one line (the directory's entries, then "Nothing was installed.") and no longer embeds the suggested commands: they are incur call-to-actions, data under `cta.commands` (each with its kind, "a release archive" or "may be a set directory") in TOON and JSON output, and a `Next:` list, one command per line, in a terminal. They carry your flags as before, `--proxy <url>` still a placeholder, never your proxy URL or its credentials. The `InstallError` webveil's `installRecipes` throws keeps its `suggestions`; its message no longer names any command.
