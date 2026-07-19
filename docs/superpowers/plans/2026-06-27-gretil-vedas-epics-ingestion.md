# GRETIL Vedas + Epics Ingestion — Plan & State

> **Read this first when resuming.** Tracked, resumable workstream. Directive from Adnan
> (2026-06-27): ingest **all the Vedas and the epics (Mahābhārata, Rāmāyaṇa, and the rest)
> from GRETIL**, clean them, **run them through the in-house translation pipeline**, and split
> them into **proper canonical chapters**. In-house translation (NOT public-domain Ganguli/
> Griffith — Adnan chose the pipeline route). Cost is not the constraint; the 5-hour window is.

## Scope note
This EXTENDS `docs/superpowers/specs/2026-06-25-gretil-ingestion-design.md`, which scoped GRETIL
ingestion to the *philosophical canon* and explicitly **excluded** epics + Vedic/ritual texts.
Adnan verbally widened the scope to include them. The pipeline METHOD from that spec still holds
(clean → chapterize → Claude-translate → integrate); only the text set changes.

## Sources STAGED (t2work/gretil/raw/, fetched from gretil.sub.uni-goettingen.de)
| Text | File | Format | Canonical numbering → chapters |
|------|------|--------|-------------------------------|
| Ṛgveda (Aufrecht) | `rigveda.xml` (4.8M) | TEI, nested `<div n=>` | maṇḍala(1–10) → sūkta → ṛc. Chapters = 10 maṇḍalas |
| Sāmaveda | `samaveda.xml` (266K) | TEI | (verify in build) |
| Atharvaveda (Paippalāda) | `atharvaveda_paippalada.xml` (2.4M) | TEI | kāṇḍa → sūkta |
| Rāmāyaṇa (Vālmīki) | `ramayana.xml` (4.0M) | TEI, nested `<div n=>` | kāṇḍa(1–7) → sarga. Chapters = sarga within kāṇḍa |
| Mahābhārata | `mbh_parvas/MBH1-18U.HTM` (all 18 parvas, one file) | HTML | every line tagged `PP,AAA.SSSx` = parva,adhyāya,śloka,pāda. Chapters = adhyāya within parva |

URL bases: TEI = `…/gretil/corpustei/<name>.xml`; MBh = `…/gretil/1_sanskr/2_epic/mbh/mbh1-18u.zip`.
**Still to fetch:** Yajurveda recensions (Taittirīya/Vājasaneyi/Maitrāyaṇī/Kāṭhaka), Atharvaveda
Śaunaka (`…/1_sanskr/1_veda/1_sam/`), and the "and the rest" follow-on (Brāhmaṇas, principal
Upaniṣads, Purāṇas) — enumerate from the GRETIL corpustei index during the build.

## Pipeline (per text) — reuse the proven shapes
1. **Clean** (deterministic): strip TEI/HTML markup, teiHeader, page/apparatus markers, GRETIL
   boilerplate. **Preserve the source transliteration scheme as-is — do NOT convert** (record
   `transliteration_scheme` in metadata, per the GRETIL spec). Segment by the embedded reference
   number, never by stray tags.
2. **Chapterize canonically** by that embedded numbering (table above) → per-chapter
   `transliteration.md` (source scheme) + `*.paragraphs.json` (p-ids). Decide MBh shape: 18 parva-
   works, vs one work with parva-chapters (≈2000 adhyāyas is too many chapters for one work →
   lean to **one work per parva**, chapters = adhyāyas; or one Mahābhārata work, chapters = parvas
   with adhyāya sub-headings). Rāmāyaṇa: one work, 7 kāṇḍa = coarse chapters or kāṇḍa-works w/ sarga
   chapters. Ṛgveda: one work, 10 maṇḍala chapters.
3. **Translate (in-house)** — the Perseus rolling-context **subagent** pipeline (NOT OpenRouter),
   Sanskrit→English, terminology-preserving with a per-work glossary (`{{term:…|gloss}}`). THIS IS
   THE LONG GRIND (MBh alone ≈1.8M words). Batch + resume; grind via background subagents + the
   2:15am cron, like the figure layer.
4. **Integrate**: `corpus/works/<slug>/…` + manifest entry (mirror `scripts/perseus/apply.ts`).

## Build status
- [x] Sources confirmed + bulk STAGED (RV, SV, AV-Paippalāda, Rāmāyaṇa, full MBh). De-risked:
      format clean + canonically numbered.
- [x] cleaner + canonical chapterizer BUILT + TDD'd (`scripts/gretil/tei.ts`, 4 tests, commit on branch)
      + VALIDATED on the real **Ṛgveda**: 10 maṇḍala chapters, **10,552 verses** (canonical Śākala count ✓),
      Vedic accents preserved. Ref-based parse (`<l n=>`) serves every corpustei TEI (RV/Rāmāyaṇa/SV/AV).
- [ ] NEXT: tiny run-script to emit staged chapters (`transliteration.paragraphs.json` + p-ids) per text;
      then the **Mahābhārata** HTML parser (different format — `PP,AAA.SSS` line refs, not TEI).
- [ ] Wire the **translation grind** (reuse `scripts/perseus/` rolling-context, subagent-driven,
      batch-resumable with a disk/quota watermark like `ingest-archive.ts`).
- [ ] Run it: translate + integrate, grinding via background workers + the cron across sessions.
- [ ] Enumerate + stage the remaining texts (YV, AV-Śaunaka, Brāhmaṇas, Upaniṣads, Purāṇas).

## Why this matters (provenance)
The citation/figure knowledge graph's loudest acquisition signal is exactly this corpus — the
Mahābhārata (←54 figures) and Ṛgveda (←53) are the top "founding texts to acquire." Ingesting them
closes those founding-text edges in-corpus and makes the Indic figure pages first-class. See
`docs/superpowers/plans/2026-06-26-citation-graph-loop-state.md`.
