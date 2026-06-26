---
title: Anonymous-payment search APIs (Kagi BTC / x402 wallet-as-credential) as a backend class
slug: anonymous-payment-search-apis
---

## The third axis I was missing

Earlier capture framed backends as either "account-free" or "account-bound key". A parallel
research session surfaced a THIRD category that is more webveil-aligned than a normal keyed
API: **commercial search APIs payable ANONYMOUSLY** (pseudonymous account + crypto, or
wallet-as-credential micropayments). This is the "Mullvad-style" middle: you DO pay, but the
payment is not tied to an identity. Worth a first-class place in the roster decision.

Source: parallel-session web research, 2026-06-26 (Kagi privacy/API docs, Brave bx402
experiment, Pylon/MeshSearch x402 docs, Presearch). Treat specifics as of that date; verify
before building (this space moves fast and is partly experimental).

## The candidates

### Kagi Search API (closest to Mullvad's ethos on POSTURE)

- Real paid search API. Requires a Kagi ACCOUNT, but Kagi explicitly supports maximizing
  anonymity: pseudonymous email, pay with cryptocurrency (OpenNode = Bitcoin/Lightning), Tor
  access, Privacy Pass auth. No Monero; BTC/Lightning not cash.
- Pricing (2026-06): ~$12 / 1,000 searches. Account + payment method required.
- For webveil: it is just a keyed HTTP backend (account -> API token), so it fits the
  existing seam trivially (like tavily-compat with a different shape). The "anonymous" part
  is the USER's account/payment hygiene, NOT something webveil implements. So a `kagi`
  backend is small; the privacy is a docs/posture matter.

### x402 "wallet-as-credential" micropayment APIs (closest on the no-account MECHANIC)

The emerging pattern that best matches "anonymous payment": NO account, NO API key; an
x402 stablecoin micropayment IS the credential; a pseudonymous wallet is the identity.

- **Pylon Web Search API** - no signup, ~$0.003/search via x402 (USDC on Base), wallet =
  credential.
- **MeshSearch** - designed around anonymous USDC micropayments, ZK query commitments, onion
  routing; no account, wallet only; self-hostable.
- **Brave bx402** (official Brave experiment) - pay-per-request proxy in front of Brave
  Search; the stablecoin micropayment is the credential, no API key/account. USDC (Base) or
  pathUSD. Experimental.
- Caveat: USDC on a public chain is PSEUDONYMOUS, not Monero-private. None take Monero today.

### Others noted

- **Presearch API** - decentralized, non-profiling, accepts BTC/USDC/PRE (and fiat); gateway
  claims to strip IP/device metadata; API account status less clear than Kagi's.
- **Brave Search API (plain)** - privacy-branded but requires account AND a credit card even
  on the free tier (anti-fraud), so the PLAIN API fails the no-identity test; bx402 above is
  the anonymous front for it.

## What this means for webveil

- **A `kagi` backend** is the cheapest concrete win in this class: trivial keyed-HTTP backend
  (one file + registry line + tests, auth header from `config.apiKey`), and Kagi's own
  BTC/Tor/pseudonymous-account story lets a privacy-minded user stay anonymous WITHOUT
  webveil doing anything special. Document the anonymity recipe; do not implement payment.
- **x402 backends** (Pylon/bx402/MeshSearch) are more interesting philosophically (no account
  at all, payment-as-credential) but require webveil to perform an x402 micropayment flow
  (sign + send a stablecoin payment per request, hold a wallet/key). That is a SIGNIFICANT
  new capability and dependency (a chain wallet, key handling, an onchain/L2 RPC path that
  must ALSO respect egress) - much heavier than a keyed HTTP backend. Likely a separate
  package if ever, and a real design exercise (key custody, fail-loud on payment failure,
  egress for the payment RPC).

## Why an idea, not a task

Pure product/scope + threat-model call (and key/payment handling is humanOnly-by-nature).
Decide: does webveil want to bless a paid-but-anonymous tier at all, and if so start with
the cheap one (`kagi`, keyed HTTP + docs) before the heavy one (x402 wallet flow)? The
keyless/self-host paths (`searxng`, public-instance-over-egress, Playwright) remain the
no-money options; this note is specifically the "pay without an identity" lane.

## Relation to other notes

- The paid lane of `expand-search-backend-roster` (which covered keyed APIs like Brave but
  not the anonymous-payment angle).
- Contrast: `public-searxng-over-egress` + `playwright-search-backend` are the no-money,
  no-account lanes; this is the pay-anonymously lane.
- `default-backend-policy-account-vs-origin` frames the account-vs-origin distinction this
  builds on (anonymous payment removes the account-IDENTITY axis while still paying).
