# Falsafa.ai Design Audit — pre-redesign baseline

**Date:** 2026-07-19 · **Method:** impeccable detector (46 rules) over `apps/site/src` + full-page visual review of home, works browse, work detail (Iliad), reader (Iliad Bk 1), atlas placeholder, engine room, at 1280px + 375px, dark + light themes.

## Verdict

The bones are good — the reader is genuinely editorial, the copy voice is strong, the palette is a committed identity. But the **section grammar is AI-template scaffolding**: the same five tells repeat on every surface, and the site's most distinctive raw material (nine scripts, the harvest, the spectrum of eras) is barely used. The redesign should keep the identity and replace the grammar.

## AI-tell inventory (kill list)

1. **Uppercase tracked eyebrows above every section** — sitewide grammar: home (×5: A LIVING LIBRARY… / THE SHAPE OF THE CORPUS / FEATURED READING / WHY THIS LIBRARY EXISTS / UNDER THE HOOD), works (THE LIBRARY), work detail (CLASSICAL · GREEK), atlas (THE ATLAS OF CARRIED BOOKS / THE CHAINS), engine (THE ENGINE ROOM), reader (TRANSLATED BY…). This is the #1 saturated AI scaffold. One deliberate kicker can stay as a named system; an eyebrow on every section cannot.
2. **Hero-metric template** on home: 2,018 / 25,499 / 9 / 622 as big-number + small-caps-label row. Named absolute ban. Mini variants repeat on work detail (CHAPTERS/VARIANTS/GENRE/DIFFICULTY) and atlas (WORKS/CROSSINGS/CARRIERS/…).
3. **Identical card grids**: works browse renders **all 2,018 identical bordered cards in one DOM** (also a perf bug); atlas chains grid; engine room's 4 link cards.
4. **Arrow-suffix `→` links as the universal CTA** — five+ per page.
5. **Detector findings (9)**: 6 side-tab accent borders (`border-left: 3px solid`) in atlas works/[id], reader.css, byok.css, eval.css, global.css, thesis.css; 3 layout-property transitions (padding/width) in works/[slug], reader.css, thesis.css.
6. **Random featured work with no editorial judgment** — rotation surfaced "Vratisasana — *Unknown*" as the home-page hero book.
7. **Dead right half** of the desktop hero at ≥1280px; every section runs the same single-column cadence (no art direction per section).

## What is genuinely good (keep / extend)

- **The reader page** — drop cap, ~70ch measure, Crimson Pro body, translator credit, Original/English toggle. Real editorial quality; the strongest surface. Preserve.
- **The era spectrum** on home — real corpus data as the page's one distinctive graphic. Mobile version (horizontal ledger bars with counts) is *better* than desktop. Extend this "data as ornament" idea; it is the most only-Falsafa element on the site.
- **The committed palette** — paper/ink/terracotta with dark + sepia themes (DESIGN.md, April 2026). Register-honest for a library of physical books. Identity-preservation wins; do not re-palette.
- **Copy voice** — "The library is the demo", "Every classical text that survives was carried", "a librarian, with no vector database". Keep the voice; it is the brand.
- **Faceted browse sidebar** with live counts (era/language/genre/difficulty).
- **Language-dot chains** on atlas cards (GREEK — LATIN — ENGLISH) — a meaningful, ownable motif; evolve it for the real atlas.
- **Mobile structure** holds up everywhere sampled.

## Structural gaps (not just aesthetics)

- Nine scripts (polytonic Greek, Devanagari, Nastaliq, Kawi…) are **invisible in the chrome** — the single most differentiating visual asset the project owns is unused.
- The atlas runs on fake hand-curated data; nothing reads the harvest (rebuild in flight).
- Works browse needs virtualization/pagination or progressive rendering — 2,018 cards ship in HTML.
- Featured-work rotation needs an editorial floor (never "Unknown" authors, prefer works with covers + descriptions).

## Notes for verification phase

- Browser-pane compositor produced blank screenshots after programmatic scroll (content verified present + styled via DOM inspection — not a site bug). Use tall-viewport captures for full-page proof.
- Cookie banner (GA4 consent) overlays every first view; account for it in screenshots.
