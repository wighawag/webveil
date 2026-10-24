# Wikipedia not bundled: its User-Agent policy rules out a browser-impersonating client (2026-10-24)

Noticed while building `bundled-wiby-wikipedia`, which asked to bundle a Wikipedia code recipe (MediaWiki search on `en.wikipedia.org`) only if a request a browser page would make is within the Wikimedia User-Agent policy, and to ship Wiby alone otherwise. It is not, so `wikipedia.mjs` was not written and the default chain is `["mwmbl", "marginalia", "wiby"]`.

What the documents say (read 2026-10-24):

- The [Wikimedia Foundation API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) (version 1.0, 2024-08-26) say an operator (anyone who deploys software that calls the APIs, the Action API and REST API included) "must: Follow the User-Agent policy and otherwise correctly label user agents", and must not "Spread Wikimedia API requests over multiple user agents to hide excessive use by a single operator". Enforcement is by blocking.
- The [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) asks automated clients for a descriptive User-Agent with contact information, and says: "Do not copy a browser's user agent for your bot, as bot-like behavior with a browser's user agent will be assumed malicious."
- Its one exception: "Browser-based applications written in JavaScript are typically forced to send the same User-Agent header as the browser that hosts them. This is not a violation of policy", with an `Api-User-Agent` header encouraged.

Why that rules it out: searchcast's strict impersonation sends a real Chrome's User-Agent (and every other fingerprint), on purpose, and webveil never weakens it. webveil is not JavaScript hosted in a browser, so the exception does not cover it, even for a `kind: 'fetch'` from the API's own origin (as `marginalia.mjs` does). Adding an `Api-User-Agent` author header (a searchcast `fetch` can carry one) was considered and rejected: the User-Agent would still be a copied browser's, which is exactly what the policy forbids, and the header would label every webveil user's traffic.

What would change it: a written exception or clarification from the Wikimedia Foundation (the guidelines invite requests to legal at wikimedia.org), or a webveil design that lets one engine send its own User-Agent, which the security rules (strict impersonation) currently forbid. Either is an owner decision, not a recipe change.
