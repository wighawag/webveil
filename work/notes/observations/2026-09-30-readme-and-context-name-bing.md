# README and CONTEXT.md name Bing (2026-09-30)

Noticed while building default-chain-mwmbl: the spec rule "no real search engine named in code, tests, examples or docs, except Marginalia and Mwmbl" is broken by pre-existing text: `README.md` ("Decoy guard (for Bing and the like)", with a `"decoyGuard": ["bing"]` example and `WEBVEIL_SEARCHCAST_DECOY_GUARD=bing`) and `CONTEXT.md` ("A decoy ... (Bing serves them)"). Left as is (out of scope); a placeholder engine name would fix it.
