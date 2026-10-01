---
'webveil': minor
'pi-webveil': minor
---

`webveil install-recipes ipfs://<cid>[/<path>]` installs a recipe set from IPFS (a release archive, or a set directory with a `manifest.json`), through searchcast 0.4's installer: every block is fetched from a trustless gateway and verified against the CID, which is the pin, so `--sha256` is optional there (checked when given for an archive). The download follows the same route rule as a URL: through your egress with `--egress` (anonymously when it is Tor), `--proxy <url>` or `--direct`, and refused without one under a proxy egress. Gateways come from `--ipfs-gateway <url>` (repeatable), else the new `searchcast.ipfsGateways` setting (any config layer, or env `WEBVEIL_SEARCHCAST_IPFS_GATEWAYS`, comma-separated; not part of the search identity), else searchcast's defaults. `webveil recipes` shows an IPFS set's `ipfs://` source, CID and gateway (and its `sha256` only when it has one), and `webveil doctor` shows each installed `set:` entry's source. A URL or file without `--sha256` is now refused with `SHA256_REQUIRED` (exit 2) instead of a validation error (exit 1).
