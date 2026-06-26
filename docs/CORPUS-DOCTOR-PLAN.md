# Corpus doctor — metadata & chapter-boundary remediation plan

> Drafted 2026-06-12, after the MIA ingest (corpus at 1,447 works) and a
> full-corpus census. Problem statement from Adnan: metadata and chapter
> boundaries of books taken from many different sources are broken; we need a
> systematic scan-and-fix.

## What the census found (all 1,447 works, by source)

| issue | oll (199) | gutenberg (89) | perseus (819) | marxists (299) | other+hart (41) |
|---|---|---|---|---|---|
| author birth/death years missing | 199 | 89 | 819 | 9 | 24 |
| published_year missing | 199 | 89 | 805 | 3 | 30 |
| placeholder one-line bios | 182 | 2 | 0 | 9 | 0 |
| works w/ apparatus chapters (ADVERTISEMENT, BIBLIOGRAPHY, NOTES…) | 43 | 0 | 0 | 4 | 0 |
| works w/ duplicate chapter titles | 59 | 0 | 6 | 0 | 1 |
| works mostly generic titles ("Chapter I", "Book 2") | 15 | 40 | 251 | 23 | 5 |
| unsplit books (1 chapter, >20k words) | 0 | 26 | 61 | 5 | 4 |
| tiny chapters (<100 words) | 488 ch | 9 ch | 199 ch | 16 ch | 89 ch |
| works w/ mostly ALL-CAPS titles | 66 | 0 | 0 | 14 | 2 |

Reading of the data: the worst metadata debt is OLL (placeholder bios,
no years, apparatus chapters, duplicate titles — e.g. Wealth of Nations
repeats "CHAPTER I." across its five books); the worst chapterization debt
is Gutenberg/Perseus unsplit single-blob books (e.g. Russell's *Mysticism
and Logic*, 70k words in one chapter) and Perseus generic "Book N" titles
(which are often the *legitimate* classical structure — needs judgment, not
a blanket rule). MIA is comparatively clean but contributes ~23
generic-title works, 5 unsplit, 14 all-caps.

## Solution architecture

Two repair channels, chosen by whether the fix changes chapter boundaries:

1. **In-place metadata patching** (safe, no URL churn) — for author
   bios/dates/nationality and published_year/era. A patcher edits
   `index.md` frontmatter + `manifest.json` entries directly; chapters,
   sidecars and wiki are untouched. Never run a bare convert.
2. **Root-cause ingester fixes + per-work re-ingest** (for anything that
   changes chapter boundaries or titles) — fix the source ingester, re-run
   it for the affected work list only, re-apply additively via
   `scripts/perseus/apply.ts` (idempotent, slug-stable at the work level;
   chapter slugs may change, acceptable pre-launch).

### Components to build (scripts/doctor/)

- **lint.ts** — the census formalized: per-work issue records with
  severity → `corpus-lint.json` + human summary. Re-run after every fix
  wave; becomes a permanent pre-deploy gate with per-issue budgets
  (apparatus = 0, dup-titles = 0, thin-bio = 0, unsplit only on an explicit
  whitelist of legitimately single-chapter works like court speeches).
- **authors-registry.json** — one canonical record per author (~362):
  dates, nationality, 2–3-sentence neutral bio. Built by an agent fleet
  (research grounded in the works we already hold + standard reference
  knowledge), **adversarially verified** (second agent checks every date
  before it ships — bios are public-facing facts). Ancient authors get
  negative-year birth/death (e.g. Plato −428/−348) or null when genuinely
  unknown.
- **enrich-authors.ts** — applies the registry to every index.md +
  manifest entry (channel 1).
- **backfill-years.ts** — published_year for OLL/Gutenberg works from
  their own title pages/source records (agent pass, evidence required),
  then era recomputed from year; fixes the 2 known era mismatches (Charles
  Comte 1834 tagged Enlightenment).

### Per-ingester fixes (channel 2)

- **oll/ingest.ts**: skip apparatus headings (advertisement, bibliography,
  notes, errata…); merge <100-word fragments into the following chapter;
  qualify duplicate chapter titles with their book/part context ("Book II —
  Ch. I: …") taken from the preceding higher-level heading; bios/years from
  the registry. Re-ingest all 199 (ePubs re-download, pipeline exists).
- **gutenberg/ingest.ts**: heading detection for the 26 unsplit books
  (essay collections with non-standard headings; fallback = match the
  book's own table of contents lines). Re-ingest affected works only.
- **marxists/ingest.ts**: title-case normalization for all-caps title
  sets; h4-level splitting for the 5 unsplit; re-ingest affected (~40).
- **perseus**: judgment pass first — an agent reviews the 61 unsplit and
  251 generic-title works and classifies "legitimate classical structure"
  vs "broken"; only the broken get re-ingested. (Most "Book N" titles are
  correct for classics.)

### Verification

After each wave: lint budgets must drop monotonically; an agent QA panel
eyeballs a stratified sample (10 works per source: titles, first/last
paragraphs, no apparatus). Single redeploy only after waves A+B pass —
the pending MIA deploy is parked until then so the public site never
shows the broken state at larger scale.

## Execution order

- **Wave A** — lint.ts + author registry + enrich (biggest visible win,
  zero URL churn, no re-ingest). ~1 session.
- **Wave B** — OLL re-ingest with apparatus/dup/tiny/bio fixes. ~1 session.
- **Wave C** — Gutenberg + Marxists re-splits and caps normalization.
- **Wave D** — Perseus judgment pass (defer if time-boxed; lowest harm).
- **Wave E** — wire lint into the deploy procedure (documented in
  STATE-AND-ROADMAP) and redeploy + QA.

## Status

- [x] Census run; formalized as scripts/doctor/lint.ts (validated, matches
      census; `--gate` mode for the deploy gate).
- **Wave A COMPLETE (2026-06-15), verified by lint:**
  - Author registry: 351 authors (309 researched + adversarially verified,
    33 verify corrections; 9 MIA + 22 canonical authors hand-written in
    house style as b99/b98; Plato/Aristotle/Hippocrates etc. self-healed
    from best existing corpus metadata). George Hamilton excluded (the
    research fleet misattributed him as Mary Agnes Hamilton).
  - Applied in place to 1,432 works: every author now has a real 2-sentence
    bio, correct birth/death years, nationality; 286 publication years set;
    30 era corrections (century-crossing only; early-modern Renaissance↔
    Enlightenment boundary left as curated; posthumous/reprint years gated).
  - Fixed 14 malformed-YAML smṛti/kawi frontmatter blocks (`author: <sage>`
    + stray `name: Unknown`) → proper sage attribution matching the manifest.
  - **Lint deltas (census → now):** bio_thin 491→1 (George Hamilton only),
    missing_author_years 1,119→53 (all legitimately null — Homer, Hesiod,
    smṛti sages, anonymous early-Christian texts, the Levellers, composites),
    era_year_mismatch →0, malformed YAML 14→0.
  - Lint hardened: bio check now catches name-prefixed/Perseus/unknown
    placeholders; era check is death-aware (posthumous not flagged);
    missing-years ignores anonymous/legendary authors. Budgets set to pass
    the metadata dimensions; structural budgets remain Wave B/C targets.

- Wave A history (now folded above):
  - [x] scripts/doctor/build-registry.ts (merge workflow batches + verify
        corrections → scripts/doctor/authors-registry.json)
  - [x] scripts/doctor/enrich-authors.ts (in-place index.md + manifest
        patcher; gates: suppress published_year >120y posthumous; recompute
        era only for lifetime publications, never posthumous compilations)
  - [~] author registry workflow: 18/26 batches done (~216 authors);
        resume run whf0kbyom finishing the rest. Adversarial verify = 0
        corrections so far (clean). NOTE: verify corrections currently only
        reach the registry via -verify.json sidecars, which the verify
        agents are NOT reliably writing — if a wave reports corrections>0,
        capture them from the workflow result before build-registry.
  - [ ] rebuild registry (all batches) → dry-run enrich → eyeball sample →
        `--write` → lint delta (bio_thin & missing_author_years should
        collapse) → census recheck
- [ ] Wave B (OLL apparatus/dup/tiny re-ingest)  - [ ] Wave C (Gutenberg/
      Marxists re-splits)  - [ ] Wave D (Perseus judgment)  - [ ] Wave E
      (lint gate wired into deploy, then redeploy + QA)

## ⚠ BLOCKER: disk full (2026-06-15)

The Mac volume is at 100% (432/460 GiB used; bulk is non-repo data). I freed
the stale 773 MB `corpus/search.db` (regenerable) to get ~880 MB headroom —
enough for Wave A's small in-place text edits, but **not** for Wave B/C/D,
which re-ingest sources (ePub downloads + temp convert dirs + sidecar
regeneration = several GB) — the clean approach. In-place structural surgery
on 1,447 works at <1 GB free risks a corrupted corpus with no rebuild path
(search.db is gone and can't rebuild without disk; the dist builds in CI).

**Remaining structural lint findings (Wave B/C/D, need disk):** apparatus
chapters 47, dup chapter titles 66, all-caps title sets 80, generic titles
338 (most Perseus "Book N" are legitimate — Wave D judgment), tiny chapters
158, unsplit books 96.

Wave A work is on disk, **uncommitted** (repo policy: commit only when asked;
also a large commit is disk-risky now). The researched author registry lives
at scripts/doctor/authors-registry.json — the expensive-to-regenerate
artifact — and the corpus edits are fully reproducible from it via
`enrich-authors.ts --write`.

**To resume:** free several GB on the Mac, then Wave B per this plan.
- Parked: deploy of the MIA corpus (1,447 works, applied locally,
  uncommitted); corpus release tar + mcp tag bump; cross-links.json rebuild
  was still running when this plan was drafted.
