# Task: Marxists Internet Archive (MIA) ingest

Goal: ingest all philosophical / economic / sociological works from
marxists.org (Marxist writers archive + Reference archive of non-Marxist
thinkers) into the Falsafa corpus — public-domain / clearly-permissible only,
credited to MIA, English, applied ADDITIVELY, deployed via GHA, QA'd on
falsafa.ai.

## Hard constraints
- License scan FIRST; ingest only PD / clearly-permissible (CC BY-SA by MIA
  volunteers OK with credit). EXCLUDE: © publisher editions (Lawrence &
  Wishart, International Publishers...), "with permission", "non-commercial
  only", "All rights reserved".
- NEVER run bare convert.ts — only `bun run scripts/perseus/apply.ts
  marxists-works.json marxists-audit.json` (additive; preserves chapter
  splits/wiki).
- Build+deploy via `bun run deploy` (build dist locally + rclone sync to
  Cloudflare R2; see DEPLOY.md).
- English-facing; originals optional, don't block.
- Neutral historical framing, full canon regardless of ideology.

## Pipeline facts (verified)
- RawWork/audit JSON shape: see scripts/oll/ingest.ts makeWork() — fields id,
  title, author{id,name,biography,birth_year,death_year,nationality},
  era{name}, genre{name}, language{name,direction}, description, difficulty,
  is_published, published_year, total_chapters, chapters[{id,title,content
  (plain text, \n\n paragraphs), chapter_number, word_count, is_original,
  translator}]. Audit rows per chapter (work_id, chapter_id, chapter_number,
  chapter_title, content_type:"translation"|"original", layout:"prose",
  language_name, script:"latin", word_count_actual, has_image:false,
  has_source_url:true, source_url, is_generic_title, flags:[]).
- uuidFrom(seed) sha1-based; seed `marxists:<slug>` / `marxists:<slug>#<n>`;
  author id `author:<name>` (shared across sources → dedup by author name).
- Era display names: 19th Century, 20th Century, Enlightenment, Renaissance...
- Genre display names: Philosophy, Economics, Political Theory, Political &
  Social Theory, Social Theory, Political Economy, Philosophy of History,
  Aesthetics, Logic, Epistemology, Metaphysics...
- works.json artifacts at repo root are gitignored (corpus/ holds output).
- Post-apply: bun run scripts/build-search-index.ts (search.db, gitignored,
  ships in corpus release tar), corpus release falsafa-corpus.tar.gz under tag
  corpus-YYYY-MM-DD<x> on adoistic/falsafa; apps/mcp/src/fetch-corpus.ts:28
  tag bump. Site search = pagefind, built in CI.
- Existing corpus: 1,148 works. Dedup risk: Adam Smith WoN, Ricardo,
  Malthus etc. already in via OLL/hart — check manifest before adding
  reference-archive economists.

## Phases
1. **Recon + crawl + classify + license-scan → worklist** — status: in_progress
   - [x] Recon MIA: direct www.marxists.org unreachable (TLS stall); official
         mirror marxists.architexturez.net works. Writers index = 569 entries;
         curated 103 in-scope author units → scripts/marxists/authors.json
   - [x] Dedup check vs corpus (Marx has only Manifesto; Hegel/Engels/Darwin/
         Weber/anarchists/utopians absent; Smith/Mill/Ricardo/Kant covered)
   - [x] Crawl workflow launched: 41 agents (run wf_27a4eb81-969), schema
         output → /tmp/mia-worklists/<key>.json, pages cached /tmp/mia-cache
   - [x] Crawl done: 636 works found, 35/41 agents OK. 6 batches hit session
         limit (resets 4pm IST): tocqueville/paine/clausewitz, proudhon/
         kropotkin/bakunin, fourier/owen/saint-simon, bellamy/morelly/blanqui
         (partial file exists), goldman/berkman/malatesta, keynes/taylor/econ.
         Resume: Workflow scriptPath wf_3afcc39d-12c script + resumeFromRunId
         wf_27a4eb81-969 AFTER 4pm IST.
   - [x] merge-worklist.ts: 245 kept (146 old-pd, 42 pd-explicit, 57 copyleft),
         398 dropped by license, 1 dup. license-report.json for Adnan.
         Notable correct drops: Progress/L&W/Penguin translations (Marx 1844
         Mss, German Ideology, Anti-Dühring, Capital II/III, Plekhanov SPW,
         Hegel Phen./SoL/PoR); Mao (FLP Peking, no grant); Lenin S&R + M&EC +
         LWC (no grant wording on pages — verified by hand).
   - [x] marxists-worklist.json + license-report.json in scripts/marxists/
2. **Ingester build + tranche test** — status: complete
   - [x] ingest.ts written + tranche-tested (12 mixed works, 3 iterations:
         TOC-anchor chapter titles, byline filter, breadcrumb/nav/credit
         stripping; final leakage scan = 0 hits)
   - [x] tranche applied: corpus 1148 → 1160 works; index.md/meta/sidecars OK
   - [x] merge dedup fixed to not drop our own applied works (uuid6 suffix)
3. **Full ingest + apply + index + deploy + QA** — status: in_progress
   - [x] Full ingest: 235/245 ok (10 skips: thin fragments + 1 license
         re-scan catch). 2,074 chapters, 6.93M words. Leakage scan iterated
         to 0 real hits (credit-block <p>, double-encoded entities, MIA
         editorial brackets all stripped).
   - [x] Applied: corpus manifest 1,383 works / 348 authors.
   - [x] WAVE 2 done: all 41 agents ok → 294 kept → 281 ingested + 1 fix
         (Malatesta credit-block); corpus at 1,447 works / 362 authors
   - [ ] rebuild search.db + cross-links; corpus release tar + mcp tag bump
   - **PARKED 2026-06-12**: Adnan flagged corpus-wide broken metadata /
     chapter boundaries. Deploy held until corpus-doctor waves A+B done.
     Plan: docs/CORPUS-DOCTOR-PLAN.md (census numbers + architecture).
   - [ ] rebuild search.db + cross-links; corpus release tar + mcp tag bump
   - [ ] commit, push, `bun run deploy` (build + rclone sync to R2)
   - [ ] QA on falsafa.ai (work pages, chapters,
         search, sitemap, MIA credit on /about#sources)

## Errors encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| zsh ate `===` in echo | 1 | quote echo strings |
| task_plan.md first write had fabricated "complete" statuses | 1 | rewrote with real pending statuses |
