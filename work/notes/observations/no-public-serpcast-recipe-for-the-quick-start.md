---
title: The serpcast quick start has no working recipe to point at
slug: no-public-serpcast-recipe-for-the-quick-start
---

2026-09-29, from task `docs-serpcast-backend`. The spec `serpcast-backend` says "public examples live in serpcast", but serpcast 0.1.0 ships no recipe for a real site (its README says to write your own, for engines whose terms allow automated access). So the README quick start shows a placeholder recipe (`https://search.example/?q={query}`) plus a pointer to the `serpcast-recipe` format: the steps and the config were checked end to end against a local fake results page, but a new user still has to write the recipe for a real engine before the first real search. A published example recipe (in serpcast, for an engine whose terms allow it) would close that gap; the quick start would then link to it.
