---
'webveil': patch
'pi-webveil': patch
---

`webveil install-recipes ipfs://<cid>` on a directory that cannot be a recipe set (for example a release folder's root) now suggests `webveil install-recipes` commands, one per entry worth trying, carrying your route (`--egress`, `--direct`, or `--proxy <url>` as a placeholder, never your proxy URL or its credentials), your `--ipfs-gateway`, `--name` and `--force`, and `--sha256` on the archive suggestion only. It no longer passes on searchcast's `searchcast install-recipes` suggestion, which would have run the download outside webveil's egress. The refusal is otherwise unchanged (exit 1, nothing installed). Depends on searchcast `^0.4.2`, whose IPFS installer first asks a gateway for the directory's listing only (one small request) before fetching a set directory's files.
