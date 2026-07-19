# Atlas Rebuild — Build Log

**2026-07-19** — the greenfield rebuild, first full pass. Companion docs:
[DATA-INVENTORY.md](DATA-INVENTORY.md) (ground truth), [DESIGN-AUDIT.md](DESIGN-AUDIT.md)
(pre-redesign baseline), [DESIGN-DIRECTION.md](DESIGN-DIRECTION.md) (the grammar).

## What was built

### 1. The synthesis pipeline (`scripts/atlas/`)

- **`sync-harvest.ts`** (`bun run atlas:sync`) — closes the local mirror's gap
  against R2: reads the freshness beacon (`production-run-summary.json`) and
  `responses-manifest.txt` from the public bucket, downloads missing
  `.enriched.json` windows (concurrent, validated, additive-only), refreshes
  `window-manifest.json`, records `sync-state.json`. Fail-soft offline.
- **`synthesize.ts`** (`bun run atlas:build`) — the global synthesis pass that
  DATA-INVENTORY called the biggest gap. Streams all enriched windows →
  entity resolution (diacritic-folded merge + polysemy-guarded alias fold —
  the God≠Zeus rule: only rare surfaces (≤2 carriers), only into ≫larger
  owners, never entities established in ≥3 works) → links figures↔authors and
  citations↔in-corpus works → resolves every evidence paragraph to a reader
  deep-link via `corpus/paragraph-index.json` → emits
  `corpus/graph/atlas/{meta,entities-index,citations,themes-index,works-atlas}.json`
  + per-entity detail files (page-worthy: ≥2 works, or ≥8 evidence, or a
  linked author). ~5s for 1,614 windows. Deterministic; artifacts gitignored.

At first synthesis: 1,614 windows · 357/2,018 works · 81,851 entity rows →
40,597 merged (5,962 with pages) · 12,300 citation edges · 15,547 theme
topics · 363,042 verbatim quotes. These numbers are already stale — that is
the point; nothing consumes them statically.

### 2. The auto-update contract

`bun run atlas:sync && bun run atlas:build` before a site build picks up
everything the harvester has finalized to R2 since last time; the site reads
artifacts at build time via `apps/site/src/lib/atlas-graph.ts` (graceful when
artifacts are absent — fresh clones still build). New works and new coverage
flow into every page with zero code changes. **Wired into `apps/site`
`prebuild` (after build-paragraph-index): every `bun run build` and every
`bun run deploy` refreshes the atlas automatically — the loop is closed, no
manual step remains.**

### 3. The atlas UI (`apps/site/src/pages/atlas/`)

Replaced the Naql placeholder routes wholesale (the Naql dataset itself stays
as the Book's data layer at `lib/atlas/` + `atlas/data/`). New routes, all
data-driven:

- `/atlas/` — colophon, kind ledgers, citation graph teasers, coverage
  strips (era + language), theme run, the method (with a live proof quote).
- `/atlas/{figures,ideas,places,groups,events,objects,animals}/` — catalogue
  ledgers; long tail listed as "noted, not yet mapped".
- `/atlas/<kind>/<slug>/` — ~6k entity pages: script-aware surface names,
  per-work grounded descriptions, verbatim quotes deep-linking to the exact
  paragraph (`/works/…/#p-xxx`, verified: anchor + `falsafa-cited` highlight).
- `/atlas/citations/` — the stance ledger; ⌂ marks in-library targets, the
  rest is the corpus's wanted list.
- `/atlas/themes/` — recurring concerns + the growing edge.
- Work pages gained an "In the atlas" strip (top entities, counts, coverage);
  reader pages link to it when mapped.

### 4. The site-wide reskin ("Catalogue & Ledger", now in DESIGN.md)

Home page: incipit column (real original-script opening lines read from the
corpus at build — Iliad Greek, Ṛgveda IAST, Iqbal Nastaliq), colophon line
instead of the hero-metric row, running heads instead of eyebrows, atlas as
second act with a live anchored quote, editorial floor on featured reading.
Works browse: card grid → catalogue ledger with paged rendering (200/page —
fixes 2,018-cards-in-DOM). Engine room: cards → ledger. All kickers sitewide
→ serif small-caps. All 3px side-stripes → 1px hairlines; all layout-property
transitions → transform with reduced-motion fallbacks.

**Impeccable detector: 9 findings before → 0 after.**

## Verified

- End-to-end loop: R2 beacon → sync → synthesize → entity page → ¶ →
  highlighted paragraph in the reader.
- No horizontal overflow at 375px (home, atlas, entity, catalogue); layout
  measured correct at 1280/1440/2560 (1240px centered measure, incipits fill
  the former dead half).
- Entity-resolution guard verified by the God/Zeus regression case.
- Placeholder-author citation noise filtered at synthesis.

## Session 2 addendum (2026-07-19, later): the reader↔atlas landing

- **Per-work chapter ontology artifacts** — synthesis now also emits
  `corpus/graph/atlas/works/<slug>.json` (~13 MB across 357 works): for each
  chapter, the entities anchored there with paragraph ids, match strings
  (canonical + surface names), grounded description, and atlas-page flag.
  Anchors are guarded against the phone book's deduped-id collisions.
- **Reader integration** (`components/atlas-ui/ChapterAtlas.astro`, rendered
  after ChapterBody):
  - Server-rendered collapsed "¶ in this chapter" panel — entities grouped
    by kind, linked into the atlas; works without JS.
  - **Inline gloss-marks**: client enhancement walks only the harvest-anchored
    paragraphs and marks the first occurrence of each entity's surface name
    (dotted underline; longest-surface-first, word-boundary, skips links/
    footnotes; capped at 60/chapter). Selecting a mark opens a fixed-position
    entity card (name · kind · mentions-in-work · grounded description ·
    "view in the atlas"), Esc/outside-click/scroll to close, aria-expanded
    managed, clamped to viewport on mobile.
  - Marks appear only in the variant the harvest anchored (translation for
    Perseus works; transliteration for GRETIL — verified: 40 marks in Iliad
    Bk 1 translation, 17 IAST marks in Ṛgveda Maṇḍala 1 transliteration).
    On other variants the panel note says where the anchors live.
- **Work page** — the "In the atlas" strip grew into a per-kind ontology
  section (distinct counts, top 10 per kind linked, unlinked long tail
  muted), fed by the same per-work artifact.
- Verified: popover open/close/Esc/aria, mobile 375 fit (no overflow, card
  clamped), detector still 0 findings.

## Session 3 addendum (2026-07-19, later still): sharing-ready

- **OG image system** (`scripts/og/generate-og.ts`, `bun run og:build`):
  satori (text shaped to paths with the site's real webfonts — latin +
  latin-ext registered as fallback families, so Ṛgveda/Śarīrārthagāthā set
  correctly) → resvg → sharp palette PNG. One visual system (paper, running
  head + folio, monumental serif, colophon + falsafa.ai): `default.png`,
  `atlas.png`, `engine.png` **+ one per work (2,018)**, avg 12 KB / max
  20 KB — under every messaging-app limit. Incremental via content hash in
  `.og-state.json`; wired into `prebuild`, so new works get cards
  automatically. PNG favicon fallbacks (apple-touch-icon, favicon-32) from
  the same system.
- **Full social meta** in Base.astro: canonical, og:site_name/type/url/
  title/description, og:image + width/height/alt (absolute URLs),
  twitter:card summary_large_image, theme-color. Work + chapter pages carry
  their per-work card; atlas pages `atlas.png`; engine `engine.png`.
- **Landing page, second pass**: monumental masthead (clamp → 80px), and a
  new **State of the Library** ledger — works · chapters · 1.37M addressable
  passages · entities · citations · verbatim anchors (each with a scholarly
  note, big oldstyle numerals) + the harvest progress bar. All values from
  manifest/atlas artifacts (synthesize now emits `paragraphs_indexed`).
  Atlas-teaser kind counts switched to merged-distinct basis (consistency
  with the ledger total).
- **Font floor raised sitewide** (~70 rules across home, atlas pages, atlas
  components, works browser, engine): nothing below 14px, most metas 15–17px,
  ledger primaries 18–21px.
- Detector: still 0 findings.

## Session 4 addendum (2026-07-19, night): the concordance — one concept, one page

Adnan caught the fundamental gap: "Alethes (truth)" / "Truth (Satya)" /
"Truth" were three pages; Kāla and Time two. Surface-string merging cannot
see cross-lingual identity. The fix is a **concordance layer** in synthesis:

- **Measured first** (`scripts/atlas/analyze-duplication.py` →
  `duplication-report.json`): per-kind gloss-collisions (2,535 — the
  harvester's own parentheticals declare equivalences), the-prefix twins,
  plurals, compounds, figure epithets.
- **Deterministic clustering** in synthesize.ts: parenthetical-gloss folds
  (base-first for concepts; gloss-target-only for figures — "Alexander
  (Paris)" proves base names lie), the-prefix, conservative plural folds
  (never figures: Gods≠God), figure epithets ("Zeus the Liberator" → Zeus).
- **`scripts/atlas/concordance.json`** — the curated authority file:
  `never` guard pairs (dharma≠law, ṛta≠truth, Ātman≠Soul, Gods≠God …),
  explicit `clusters` (kāla→time, satya/alḗtheia→truth, Ilium→Troy,
  Lacedaemonians→Spartans …), `renames` for cross-lingual homographs the
  diacritic fold would wrongly conflate (Greek timê "honor" keys as "time" —
  renamed into Honor at ingest; rename targets must land in the TRUE
  concept, never re-collide), and reviewer-flagged `junk` (demoted from
  page-worthiness, data retained).
- **Expressions kept legible**: folded members become `expressions` on the
  head's detail file — name, gloss, mentions, works, quotes — rendered as a
  "spoken of as" section. Time's page now reads: *Kāla — "Time" —
  Tarkasaṃgraha (Sanskrit): "Time is the cause of usage such as 'past'…"*
- **See-references**: 2,206 folded names become ledger cross-references
  ("Kāla, *see* Time") and redirect stubs at their former URLs.
- **Category review at scale**: seven parallel Claude subagents read every
  kind's ledger (9,976 names) against a hard-rules brief (never merge
  contested concepts; collective≠singular; shared-name≠same-person);
  `apply-review.py` validates their proposals against the index + guard
  list before anything enters the concordance. First pass: 3,805 entities
  clustered.

## Known follow-ups

- Theme clustering (15k near-unique topics) and deeper entity resolution
  (plural stems, cross-lingual variants) remain open threads.
- `vite.server.watch.ignored` excludes `corpus/**` in dev (EMFILE guard).
- Browser-pane compositor produced unreliable screenshots after viewport
  resizes during verification; layout facts were verified via DOM
  measurement. Re-shoot marketing screenshots by hand if needed.
- Old deep atlas URLs (`/atlas/works/<id>/`, `/atlas/people/…`) 404 by
  design (placeholder discarded); `/atlas/` root links all remain valid.
