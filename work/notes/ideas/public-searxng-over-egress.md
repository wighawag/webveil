---
title: Public SearXNG instance + webveil egress — the no-self-hosting, still-anonymous path
slug: public-searxng-over-egress
---

## The idea

The "you must self-host SearXNG" objection has a real middle option I under-documented:
point webveil's `searxng` backend at a PUBLIC SearXNG instance (searx.space lists many) and
route webveil's hop to it through `socks5` egress (Mullvad/Tor). This is the ONE case where
"remote backend over SOCKS" genuinely buys something:

- No self-hosting (zero setup on your side).
- Real web results (the public instance does the engine crawling).
- Your IP is hidden FROM the instance (webveil's egress proxies the hop to it).

It is COHERENT with the anonymity-boundary model (`webveil-anonymity-boundary`): the public
instance is a REMOTE backend, so webveil's egress to it IS a public-internet hop worth
proxying \u2014 unlike a LOCAL instance (which the fail-loud guard rejects under proxy egress).

## The honest tradeoff (must be documented, not hidden)

- You TRUST THE INSTANCE OPERATOR with your QUERY CONTENTS (they see what you search,
  just not who/where you are). A self-hosted instance avoids this; a public one does not.
  This is a different threat model from "no account" \u2014 spell it out so users choose
  knowingly.
- Reliability: public instances are unstable, rate-limited, and **many block the JSON API
  (`format=json`)** webveil needs \u2014 so a given instance may simply not work as a backend.
  Pick one that allows JSON; expect to rotate.
- Still account-free and key-free (SearXNG public instances need no login).

## What it needs (small)

Mostly DOCS, not code: a README subsection under the anonymity section showing
`WEBVEIL_BASE_URL=https://<public-instance>` + `WEBVEIL_EGRESS=socks5` + the
trust-the-operator caveat + "must allow format=json". Optionally a curated/known-good
instance hint, but do NOT hardcode a default public instance (that would silently send
everyone's queries to one third party \u2014 the same objection as the default-backend note).

## Relation to other notes

- Complements `expand-search-backend-roster` (this is the no-setup answer to itch (a)).
- Bounded by `webveil-anonymity-boundary` (remote-over-SOCKS is the allowed case; the
  loopback guard does not fire here because the baseUrl is remote).
