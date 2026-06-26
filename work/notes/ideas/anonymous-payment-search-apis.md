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
x402 micropayment IS the credential; a pseudonymous EVM wallet is the identity. The flow:
first request returns `402 Payment Required`, the x402 client auto-pays and retries.

**Maintainer decision: on-chain ETH/EVM payment is ACCEPTABLE.** That makes this lane viable
for webveil, with one crucial nuance:

- **Chain vs token nuance (do NOT assume ETH-on-L1):** almost all of these price in **USDC
  on Base** (Coinbase L2), not ETH on L1 mainnet. "I'm fine paying on-chain with an EVM
  wallet" -> you are in great shape (standard EVM wallet). "Literally ETH on L1" -> rare and
  economically silly: L1 gas would dwarf a $0.003 search. So the realistic target is
  **EVM wallet + USDC, usually on Base** (cheap gas). Design for USDC/Base first.

- **Pylon Web Search API** - the cleanest match. No signup/key; ~$0.003/search via x402,
  USDC on Base; a funded EVM wallet is the only requirement. LIVE, hosted. Best "pay
  anonymously on-chain right now" option.
- **Brave bx402** (official Brave experiment) - proxy in front of the real Brave Search API;
  no key/account, signed micropayment is the credential. Two rails: x402 (USDC/Base) or MPP
  (pathUSD/Tempo), selected by which payment header the wallet sends. Brave-quality index,
  Rust, self-hostable. EXPERIMENTAL.
- **MeshSearch** - most privacy-maximalist: EVM wallet only, anonymous USDC micropayments +
  ZK query commitments + 3-hop onion routing + encrypted history. But currently Base SEPOLIA
  (testnet) in the repo -> "run it yourself / demo", not a turnkey mainnet endpoint today.

| Option | Account | Payment | Chain/token | Maturity |
| --- | --- | --- | --- | --- |
| Pylon | none | per-search | USDC / Base | live, hosted |
| Brave bx402 | none | per-request | USDC/Base or pathUSD/Tempo | experimental, self-host |
| MeshSearch | none | per-search | USDC / Base (testnet) | demo / self-host |
| Kagi | pseudonymous acct | prepaid | BTC/Lightning | live, hosted |
| SearXNG self-host | none | free | n/a | mature |

- Caveat: on-chain USDC/ETH is PSEUDONYMOUS, not anonymous like Monero/cash. Every payment
  is permanently public and linkable to the wallet; if that wallet is ever tied to identity
  (KYC-exchange purchase, funded from a doxxed address) the link is forever. None take Monero.

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
- **x402 backends** (Pylon/bx402/MeshSearch) are now a LIVE option for webveil (maintainer
  accepts on-chain EVM payment). `Pylon` is the concrete starting point: hosted, live, no
  account, USDC/Base, wallet = credential. webveil would perform the x402 flow (catch the
  `402`, sign + send the USDC micropayment, retry). This is a SIGNIFICANT new capability +
  dependency, much heavier than a keyed HTTP backend:
  - **A wallet + key custody in webveil.** webveil would hold (or be handed) a funded EVM
    wallet key to sign payments. Key handling is humanOnly-by-nature (secrets); the key must
    never be logged/leaked, and config for it needs the same care as `apiKey` but higher
    stakes (it can spend funds).
  - **An x402 client + an L2 RPC path.** Needs an x402 client lib and a Base RPC endpoint to
    submit/confirm payment. That RPC path is ANOTHER outbound hop that MUST also go through
    webveil's egress (else the payment RPC deanonymizes you even if the search query did
    not). This couples the payment layer to the egress seam, fail-loud included.
  - **Fail-loud on payment failure** (insufficient funds, RPC down, tx revert) rather than
    silently returning no results.
  - Almost certainly a SEPARATE package (e.g. `webveil-x402`) given the chain/wallet weight,
    not a core dep. Start with Pylon (USDC/Base); bx402 (self-host the proxy) and MeshSearch
    (testnet/self-host) are later.

### Operational anonymity recipe (for ANY on-chain-paid option, document it)

On-chain payment is only PSEUDONYMOUS, so the user must do the privacy work; webveil should
document it, not pretend the chain hides them:

1. Use a FRESH wallet not linked to identity, funded through a privacy step (e.g. swap
   XMR -> ETH/USDC via a no-KYC instant swapper into a clean address) rather than from a KYC
   exchange or a doxxed address.
2. Route BOTH the search API calls AND the payment RPC over webveil's egress (Tor/Mullvad),
   so the network layer does not deanonymize what the chain pseudonymity left open.
3. Understand the residual: every payment is permanently public + linkable to that wallet;
   this is strictly weaker than Monero-direct or cash, but operationally workable.

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
