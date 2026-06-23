# Progress — Falsafa corpus work

## MIA ingest (done, applied locally, NOT deployed — parked)
- 282 license-cleared works from marxists.org. Corpus: 1,448 works / 363 authors.

## Corpus doctor (docs/CORPUS-DOCTOR-PLAN.md)
- Wave A (author metadata) — COMPLETE, lint-verified.
- Wave B (OLL re-ingest) — COMPLETE. All 200 OLL works re-extracted with a
  rewritten chapterizer (§-marker skip, 2-level anchor detection, apparatus
  drop, dup→book-context, unshout). apparatus 43→0, dup 59→1, allcaps 66→0,
  tiny 88→0.
- Wave C — COMPLETE. Marxists 281 re-ingested with unshout (allcaps 14→1).
  Gutenberg: 22 of 29 unsplit re-split (Title-case headings, cardinals,
  CHAP./ordinal patterns, roman+caps essays, TOC-driven fallback, preamble
  capture). 7 hard English remain (continuous-section treatises / bundles)
  + 2 German (need original-language path).
- Wave D (Perseus) — judgment: the 61 "unsplit" are mostly legitimate single
  units (speeches, dialogues); 251 generic "Book N" titles are correct
  classical structure. ~15 genuinely under-split (Livy books, letter
  collections) left as a documented follow-up; full re-ingest deemed
  higher-risk than reward across 819 works.
- Wave E (rebuild aggregates) — IN PROGRESS: paragraph-index rebuilt
  (1.03M paragraphs); cross-links + search.db rebuilding.

## Lint: 879 issues at session start → ~612 (structural debt mostly cleared).

## To resume / finish
1. Finish Wave E: cross-links.json + search.db rebuild, then QA sample.
2. Optional: the 7 Gutenberg bundles + ~15 Perseus under-splits (per-book).
3. Commit (when Adnan asks) + redeploy (parked).
