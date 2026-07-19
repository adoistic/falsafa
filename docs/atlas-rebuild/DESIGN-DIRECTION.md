# Falsafa Redesign Direction — "The Catalogue & the Ledger"

**Date:** 2026-07-19 · Follows from [DESIGN-AUDIT.md](DESIGN-AUDIT.md). Governs the atlas rebuild and the site-wide reskin.

## The scene (why these choices)

A reader — a graduate student in Lahore at midnight, a retired lawyer in Ohio on a Sunday morning — opens a two-thousand-year-old book on whatever device is at hand, to actually read it. Warm ambient light, quiet, unhurried. And underneath, a machine-scholar traverses citations. The site is a **library reading room with a card catalogue**, not a product landing page.

## Identity: kept

Paper/ink/terracotta palette (all three themes), Crimson Pro body + Source Serif 4 display + Inter chrome, the editorial voice. This is a committed identity from the April design review, register-honest for a literal library. **Identity-preservation wins.** What changes is the *grammar* built on top of it.

## The new grammar (replaces the AI scaffold)

Every device below is drawn from the visual language of real libraries and printed books — catalogue cards, ledgers, colophons, running heads — so the system is *named and ownable*, not template-derived.

1. **Running heads, not eyebrows.** Section headers become serif small-caps set INTO the top hairline rule (like a book's running head), optionally with a folio-style marker at the right end of the rule. One named system, used sparingly — major sections only, never floating sans-uppercase over every block. All current eyebrows die.

2. **The colophon line, not the hero-metric row.** Corpus numbers appear as a single set line of serif type with inline terracotta numerals — the way a colophon states facts of printing — never as big-number billboards. Kills the stat rows on home, work detail, atlas.

3. **Ledger rows, not card grids.** The system-wide list affordance is the catalogue ledger: numbered rows, hairline rules, aligned columns (title / author / era / language / extent). The Iliad chapter list already has the bones; promote it. Works browse becomes a ledger with progressive rendering (fixes the 2,018-cards-in-DOM bug). Cards survive only where a cover image earns them (featured reading).

4. **Script as brand material.** The corpus's nine scripts are the most distinctive visual asset the project owns and are currently invisible. Original-script display type (polytonic Greek, Devanagari, Nastaliq, Kawi transliteration) appears as first-class material: work titles in original script on detail pages, surface-name specimens on atlas entity pages, a quiet multilingual line in the home masthead. Proper fonts (Noto Nastaliq Urdu, Noto Serif Devanagari) with correct line-height accommodation.

5. **Data as ornament.** The era spectrum is the model: real corpus/harvest data drawn in ledger style (thin terracotta bars, hairlines, numeral labels) is the only decoration the site gets. Extend to: harvest coverage strips (atlas), language traffic, stance distributions. Nothing decorative that is not data. The mobile spectrum (horizontal ledger bars) informs the desktop version, not vice versa.

6. **The verbatim quote as the atlas signature.** Every edge/claim in the atlas surfaces its paragraph-anchored quotation — serif blockquote, terracotta hairline, link to the exact paragraph in the reader. "No claim without a quote" is the *visible* design discipline, the thing a visitor remembers.

7. **Quiet links.** CTAs are serif small-caps with hairline underline. The `→` suffix is reserved for genuine forward navigation (next chapter, begin reading) — once per view at most.

8. **Motion: restrained and semantic.** Spectrum/coverage bars grow in on first paint (with `prefers-reduced-motion` fallback to instant); view transitions catalogue → work → chapter; nothing scroll-triggered, no entrance choreography per section.

## Editorial floors

- Featured reading must never surface an "Unknown" author or coverless obscurity; curate a rotation pool (has cover + description + named author), rotate within it.
- No page states a hardwired count: every number derives from the manifest / beacon / synthesis artifacts at build time.
- Coverage honesty: where harvest data is partial (it is: ~16%, skewed Greco-Indic), the atlas states what is and isn't mapped, in plain type — the ledger aesthetic makes partialness legible instead of embarrassing.

## Fix list carried from audit

Side-tab borders (6), layout-property transitions (3), works-browse DOM weight, dead hero right-half at ≥1280px (fill with script-specimen or spectrum material — content, not decoration).

## Slop test

- First-order: "classical library" no longer predicts the output — running heads + colophon + ledger + multiscript display is a specific, named system, not serif-on-cream defaults.
- Second-order: "classical library, but not SaaS-cream" would predict generic editorial-typographic (italic display + mono labels + rules). We diverge: no mono labels, no italic-display affectation, and the distinguishing material is *the corpus itself* (nine scripts, real data bars, verbatim quotes) — which no other site can copy.
