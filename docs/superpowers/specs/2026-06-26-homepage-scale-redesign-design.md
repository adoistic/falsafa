# Homepage Scale Redesign — Design Spec

_Author: Adnan · 2026-06-26 · Status: draft for review_

## Goal

Rebuild the Falsafa homepage so the **scale and beauty of the corpus** land in
the first second — replacing today's featured-work-first layout, where the
impressive numbers are buried in a prose sentence and the era counts sit in a
flat, evenly-weighted grid that flattens a corpus ranging from 10 works
(Ancient) to 521 (Imperial) into identical-looking cells.

The redesign leads with magnitude, then makes the corpus's true shape across
time the page's signature visual, then invites the reader in. Scale **and** soul.

## Problem with the current page

[`apps/site/src/pages/index.astro`](../../../apps/site/src/pages/index.astro)
today reads, top to bottom:

1. **Featured reading** — one random work's cover (3:2) + blurb. First impression
   is "here's a book," not "here's a vast library."
2. **The catalog** — an `<h2>`, a prose lede (`1,836 works across 10 eras, 9
   languages, 442 authors`), and the `.era-strip`: a flat CSS grid of era nodes,
   each a count + label, all visually equal weight.
3. **Why this library exists** — a two-column justification (book/atlas + engine).

Two failures: (a) the headline numbers (1,836 works, 21,516 chapters, 30,462
variant entries) never get monumental treatment — they live inside a sentence;
(b) the `.era-strip` throws away the most interesting, *ownable* fact about the
corpus — its shape in time — by rendering every era at the same size.

## Decided direction

**Fuse "by the numbers" + "the spectrum," full-page rethink.** (Chosen over:
numbers-only masthead — too cold on a literary site; a wall-of-covers hero —
beautiful but busy and cover-quality-dependent, held in reserve as a possible
lower band; and a minimal centerpiece swap — too timid for the brief.)

## Page structure (new)

```
┌─────────────────────────────────────────────────────────┐
│  MASTHEAD                                                 │
│  kicker · big serif thesis headline · one-line lede      │
│  ┌────────┬─────────┬──────────┬─────────┐               │
│  │ 1,836  │ 21,516  │    9     │   442   │  ← monumental  │
│  │ works  │ chapters│ languages│ authors │    charcoal    │
│  └────────┴─────────┴──────────┴─────────┘    numerals    │
├─────────────────────────────────────────────────────────┤
│  THE SPECTRUM   (replaces .era-strip entirely)           │
│  section label · italic intro                            │
│        ▁    █  ▅          ▂  ▁ ▁ ▁  ▃  ▃   ← bars by count │
│       Anc Cla Hel Imp  LAnt Med Ren Enl 19c 20c          │
│  Browse all 1,836 works →                                │
├─────────────────────────────────────────────────────────┤
│  FEATURED READING  (existing block, demoted to #3)       │
│  cover (3:2) | title · author · desc · Begin reading →   │
├─────────────────────────────────────────────────────────┤
│  WHY THIS LIBRARY EXISTS  (kept ~as-is)                  │
│  book/atlas column | engine column                       │
└─────────────────────────────────────────────────────────┘
```

### 1. Masthead

- **Kicker** (Inter, uppercase, terracotta): _A living library of translated thought_
- **Headline** (Source Serif 4, 700, `--fs-h1`-scale, `letter-spacing:-.025em`):
  _Twenty-five centuries of thought, carried into English._
  — "carried" ties to the book _Carried Across_ and the atlas.
- **Lede** (Crimson Pro, `--ink-muted`): _Free and open source. Built to be read
  by people — and cited, honestly, by machines._
- **Numbers row** — four stats as large charcoal (`--ink`) serif numerals
  (~48px desktop) with small uppercase muted labels beneath:

  | Value | Label | Source (build-time, already in frontmatter) |
  |-------|-------|---------------------------------------------|
  | 1,836 | works | `m.counts.works` |
  | 21,516 | chapters | `totalChapters` (`Σ w.total_logical_chapters`) |
  | 9 | languages | `m.counts.languages` |
  | 442 | authors | `m.counts.authors` |

  "25 centuries" is carried by the headline, so it is **not** repeated here.
  Word count (millions) is intentionally omitted from the hero for legibility;
  it may move into the lede later if desired.

### 2. The spectrum (the one new component)

A horizontal timeline silhouette: one vertical bar per era, chronological,
height proportional to that era's work count.

- **Data:** reuse the existing `eraEntries` array (already built in frontmatter,
  ordered by `eraOrder`, each `{ label, slug, count }`). Exclude any `Unknown`
  era — it has no position in time and would break the timeline; its works
  remain reachable via the "Browse all works" link and `/works/`.
- **Scaling:** `maxEraCount = Math.max(...eraEntries.map(e => e.count))` (= 521,
  Imperial). Bar height = `Math.max(MIN_PX, Math.round(count / maxEraCount * MAX_PX))`
  with `MAX_PX = 140`, `MIN_PX = 6` (so Ancient/Renaissance stay visible). Height
  applied via inline `style` on each bar.
- **Real silhouette** (Greco-Roman summit → medieval trough → modern second wave):

  | Era | Count | Era | Count |
  |-----|------:|-----|------:|
  | Ancient | 10 | Medieval | 34 |
  | Classical | 327 | Renaissance | 29 |
  | Hellenistic | 201 | Enlightenment | 75 |
  | Imperial | **521** | 19th century | 241 |
  | Late antiquity | 150 | 20th century | 248 |

- **Each bar is a link** to `/eras/<slug>/` — navigation, not decoration. The
  count renders above the bar; the era name below. Imperial (the max) gets a
  subtly darker bar (`#6f2c22`) as the natural focal point.
- **Section intro** (italic, muted): _Where those 1,836 works fall in time — a
  Greco-Roman summit, a quiet medieval trough, a second wave after 1800. Each
  era is a door._
- **Accessibility:** preserves today's strip semantics — `role="list"` on the
  container, each bar an `<a role="listitem">` with
  `aria-label="Imperial: 521 works"`, keyboard-focusable with a visible
  `:focus-visible` ring (reuse existing `.era-node` focus styling). No animation
  is required to read the chart; hover/focus only deepens bar colour.

### 3. Featured reading (demoted, otherwise unchanged)

The existing rotating featured-work block moves to position 3 verbatim: the
server-rendered first pick, the `application/json#featured-pool` payload, and the
inline on-load random-swap script all move down together. Real cover image
retained. This is the warm on-ramp — no longer the headline.

### 4. Why this library exists (kept)

The two-column book/atlas + engine section is retained essentially as-is; only
minor copy/spacing adjustment to sit well under the new flow.

## Responsive behaviour

- **Numbers row:** four-across on desktop → 2×2 grid on mobile (`<640px`).
- **Spectrum:** vertical bars read as a silhouette at desktop width, but 10 thin
  bars are illegible on a phone. On mobile the spectrum flips to a **horizontal
  bar list** — one row per era: `era name · count · proportional horizontal bar`.
  Same data, same links, same scaling fraction; just rotated for legibility.
- Existing mobile breakpoints (`639px`, `720px`, `420px`) and token-driven type
  scaling from [`tokens.css`](../../../apps/site/src/styles/tokens.css) apply.

## Design decisions (locked)

1. **Numbers in charcoal (`--ink`), not terracotta.** Big ink serif numerals on
   warm paper read confident and editorial; four terracotta numbers above a
   terracotta spectrum was too much red. Terracotta is reserved for the kicker,
   links, and the spectrum bars.
2. **Four numbers = works · chapters · languages · authors.** "25 centuries"
   lives in the headline; words omitted from the hero for legibility.
3. **Featured work demoted to #3.** The deliberate structural bet: trade "here's
   a beautiful book" for "here's a beautiful, enormous library — and here's your
   way in."

## Files touched

- **Only** [`apps/site/src/pages/index.astro`](../../../apps/site/src/pages/index.astro)
  — rewrite the template body and the component `<style>` block. The frontmatter
  already computes everything needed (`m.counts`, `totalChapters`,
  `totalVariants`, `eraEntries`); add only `maxEraCount` for bar scaling. No new
  data files, components, or dependencies.
- The build-time SEO `description` meta (already derived from live counts) is
  retained.

## Copy (first pass — editable)

All strings above are a first draft, written to avoid common AI-writing tells
(no "delve/tapestry/testament," no rule-of-three padding, no em-dash overuse).
They are not precious and can be revised during or after implementation.

## Verification plan

- `bun run typecheck` clean.
- Build the site locally and run the Astro dev server; load `/` and confirm:
  numbers match `manifest.json`, the spectrum bars match the era table above,
  each bar links to the correct `/eras/<slug>/`, the featured rotation still
  swaps on reload, and the page degrades correctly with JS disabled (SSR featured
  pick + static spectrum).
- Visual check at desktop and mobile widths (numbers 2×2, spectrum as horizontal
  list); dark + sepia themes via the `[data-theme]` toggle.
- Screenshot the result as proof before considering it done.
- Deploy per the established runbook — `bun run deploy` (build `dist` locally,
  then rclone sync to Cloudflare R2; the `falsafaai` Worker serves it). See
  [DEPLOY.md](../../../DEPLOY.md).

## Non-goals

- No change to the featured-work rotation mechanism, the nav/header/footer
  chrome, the `/numbers` page, or any data pipeline.
- No new charting library — the spectrum is hand-built CSS, consistent with the
  CSS-native editorial approach already locked for the launch surfaces.
- The wall-of-covers treatment (explored Direction 2) is explicitly out for now;
  it may return later as a lower-page texture band.
