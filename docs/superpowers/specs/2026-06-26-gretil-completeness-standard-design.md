# GRETIL Completeness Standard + Backfill — Design Spec

_Author: Adnan · 2026-06-26 · Status: draft for review_

## Goal

Define **one shared standard** for what a "complete" GRETIL/Indic work must contain, then
**backfill both existing batches up to it** and make the works genuinely findable. The
standard becomes the corpus-wide template for the semantic-metadata layer (Indic first;
Islamic / Chinese / etc. inherit it).

This spec is the output of an audit (2026-06-26) of all 31 `thothica_role: "gretil-root"`
works against the methodology in `docs/superpowers/specs/2026-06-25-gretil-ingestion-design.md`.

## Audit findings (what prompted this)

The 31 GRETIL works split into two batches with **mirror-image gaps**:

- **Older 19** (dharmaśāstra smṛti + Old-Javanese tattva): have `cover.webp` + the deterministic
  `wiki/` layer, but generic chapter titles ("Chapter N"), empty descriptions, no glossary.
- **Newer 12** (philosophical canon, ingested 2026-06-26): have comprehension-derived chapter
  titles, descriptions, citation schemes, and `glossary.json` — but no covers and no `wiki/`.

Three auditors (Kashmir Śaiva / Sāṃkhya-Nyāya / Buddhist) scored the newer 12 against the
2026-06-25 methodology. Verdict:

- **Scholarly craft was followed well.** 12/12 faithful `[bracketed]` translations, perfect
  1:1 transliteration↔translation paragraph alignment in every chapter, clean IAST (no TEI
  noise), 11/12 genuinely comprehension-derived chapter titles, 11/12 substantive glossaries.
- **Mechanical integration broke it.** The ingester ([`scripts/gretil/apply-complete.ts`](../../../scripts/gretil/apply-complete.ts)) is the root cause of every categorical defect:
  - **Inline gloss feature destroyed.** `readableTerms()` (line 184) matches only the exact
    spec form `{{term:word|gloss}}` and **flattens it to prose** `word (gloss)`. Works whose
    source followed the spec lost their tags (caryāmelāpaka, abhisamayālaṅkāra → 0 tags); works
    whose source used a different brace form **leak raw `{{…}}` into the published English**
    (adiśeṣa 91, simānanda 119, asaṅga 21, paryanta 21, cittaviśuddhi 31). **Zero of 12** use
    the spec convention; every glossary is orphaned from its text.
  - **Era hardcoded** (`"Medieval"`, line 371) and never derived from the work's date. Live data
    shows `"Ancient"` on all 12 — a mismatch indicating the deployed corpus is out of sync with
    the current script. Abhinavagupta (~1000 CE), Annaṃbhaṭṭa (~17th c.), and Īśvarakṛṣṇa (~400 CE)
    all collapse into one bucket.
  - **Description is a template** (line 357); only works with a hand-written `catalog.note` get
    real content (6/12). **Genre hardcoded** `"Philosophy"` for all.
  - **School/tradition (darśana) exists in no structured field** — the single most important axis
    for Indian philosophy lives only in prose/glossary/titles.
  - **Author identity conflated.** `AUTHORS["Āryadeva"]` (line 67) hardcodes 170–270 (the
    *Madhyamaka* Āryadeva) and is applied to both *tantric* Āryadeva works, contradicting their
    own descriptions; the two distinct historical authors merge into one record.

**Findability (MCP probes).** In the flat catalog the 12 resolve fine. On every discovery
surface they fail: `read_wiki` returns `WIKI_NOT_BUILT`; `find_related` on the Sāṃkhyakārikā
falls back to era-only and recommends *Āṅgirasa / Bṛhaspati / Kātyāyana Smṛti* (unrelated law
codes) because the 12 are absent from the cross-link index; no covers → placeholders; the
glossary is unlinked. They are reachable by direct URL and invisible to navigation.

### The three-way gap map

| Layer | newer 12 | older 19 |
|---|---|---|
| Text + 1:1 alignment | ✓ | ✓ |
| Comprehension chapter titles | ✓ | ✗ |
| `glossary.json` | ✓ (11/12) | ✗ |
| Cover + `wiki/` + discovery | ✗ | ✓ |
| Substantive description | ◐ | ✗ |
| **Correct period** | ✗ | ◐ |
| **School / tradition** | ✗ | ✗ |
| **Differentiated form/genre** | ✗ | ✗ |
| **Glossary ↔ text linkage** | ✗ | ✗ |

The bottom four rows are present in **neither** batch — that is the net-new shared layer.

## The standard — "a complete work"

A `gretil-root` work is complete when it has all five layers:

### 1. Text (already met by both batches)
- `transliteration.md` in the source scheme, **preserved not converted**, clean of TEI/page/
  apparatus noise; `translation.md` in English, terminology-preserving, `[brackets]` for
  elliptical additions, `translator: thothica`.
- 1:1 transliteration↔translation paragraph alignment.
- `transliteration_scheme` recorded as a **named field** (today it is only under `script:`).

### 2. Structure
- Comprehension-derived chapter titles (semantic, argument-tracking) — never "Chapter N".
- **Citation scheme as a structured frontmatter field** (today it is body prose only).

### 3. Semantic ontology — NEW, the shared layer
Queryable structured facets on every work:
- **`school` / `tradition`** — controlled vocabulary. Indic starter set: the six darśanas
  (Nyāya, Vaiśeṣika, Sāṃkhya, Yoga, Mīmāṃsā, Vedānta), Vedānta sub-schools (Advaita…),
  Buddhist schools (Madhyamaka, Yogācāra, Pramāṇavāda, Abhidharma, tantra), Jaina, Kashmir
  Śaiva (Trika / Pratyabhijñā), Cārvāka. Extensible per civilization.
- **`form`** — differentiated, replacing blanket "Philosophy": sūtra, kārikā, bhāṣya, vṛtti,
  vārttika, ṭīkā, prakaraṇa, Upaniṣad, tantra/āgama, stotra, saṃgraha/digest.
- **`period` (dual axis)** —
  - `period`: the existing global timeline buckets (Ancient…20th C), **date-corrected** per
    work (drives the homepage era-spectrum). Mapped by absolute date to the nearest bucket.
  - `tradition_period`: a tradition-relative period as a separate scholarly field. Indic vocab:
    Vedic, Upaniṣadic, Classical (Sūtra-Śāstra), Early Medieval, Late Medieval, Early Modern,
    Colonial/Modern. Each civilization defines its own controlled list.
- **Author identity** — disambiguated. The two Āryadevas become distinct author records
  (keyed by identity, not bare name); correct dates; a real 1–2 sentence bio. Addresses the
  corpus-wide author-dedup-by-name risk.
- **`description`** — substantive, per-work, no template: what the text is and its form, its
  school and position in that tradition, its central argument/structure in a clause, and a
  provenance/edition note. 2–4 sentences.

### 4. Glossary + gloss
- `glossary.json` (term → substantive, text-grounded gloss) on **every** work.
- The UI **auto-links** any glossary term it finds in `translation.md` — **no inline markup**.
  Matching rule: case-insensitive exact match on the romanized term (and declared variants),
  longest-match-wins, link the first occurrence per paragraph. Romanized Sanskrit terms
  (puruṣa, prakṛti) make false matches near-zero. `translation.md` carries no `{{…}}` markup;
  the ingester strips any residual braces to clean prose.

### 5. Findability
- `cover.webp` (cover pipeline) + deterministic `wiki/` (`build-wiki.ts`).
- An entry in the content cross-link index so `find_related` returns content matches and other
  works can surface this one.
- Present in the search index.
- `find_related` ranking made **school/tradition- and content-aware**, not era-first (today a
  huge "Ancient" bucket produces unrelated recommendations).

## Schema changes

Add to `index.md` frontmatter, the manifest work entries, and where relevant `meta.json`:
`school` (string|array), `form` (string), `tradition_period` (string), `citation_scheme`
(string, promoted from body), `transliteration_scheme` (string, aliased from `script`).
Keep `period`/`era` but populate from real dates. Author records gain stable disambiguated IDs.

## Pipeline fixes (`apply-complete.ts`)

1. **Gloss handling:** stop flattening `{{term:…|…}}`; instead strip *all* brace forms to clean
   prose for `translation.md` (gloss lives in `glossary.json`, surfaced by the UI auto-link).
   Normalize the upstream source JSONs to drop inline gloss text.
2. **Period:** derive `period` from the author's date; set `tradition_period` from the catalog.
3. **School / form / description:** read from a per-work catalog (extend the existing `CATALOG`
   map) rather than hardcoded strings.
4. **Author registry:** split `AUTHORS` entries by identity; fix the Āryadeva conflation.
5. **transliteration_scheme:** write the named field.
6. Re-run, then reconcile the live `era` mismatch.

## Backfill program (phased — each phase can be its own implementation plan)

- **Phase 0 — schema + ingester + surfaces.** Schema fields; `apply-complete.ts` fixes; UI for
  the new facets (gloss auto-link, school/form display + browse, dual-period display,
  school-aware `find_related`). Land the surfaces first so re-runs have somewhere to show.
- **Phase 1 — the 12.** Author the per-work semantic facets (school, form, dual period,
  disambiguation, real descriptions) via a Claude per-work pass; re-run the ingest; then
  `build-wiki` + covers. Brings the 12 to standard.
- **Phase 2 — the 19.** A comprehension re-chapterization pass (the 2026-06-25 method) to
  replace generic titles; add the same semantic facets + glossaries + descriptions; rebuild
  `wiki/` after re-titling (deterministic). Keep their existing covers; verify the 19's text +
  alignment too (the audit covered only the 12, which were clean). Brings the 19 to standard.
- **Phase 3 — verification.** A completeness linter (extend the `build-wiki --check` pattern)
  that fails CI if any `gretil-root` work is missing a required field or asset.

## Where the per-work content comes from

The semantic facets and the 19's chapterization are **editorial**, produced by a Claude
per-work pass following the comprehension-first method (full text in context → identity,
school, form, period, structure, description), then reviewed. This is the same proven loop
that produced the 12's good chapter titles; we are extending it to the categorical fields and
to the 19.

## Verification

A work passes the completeness check when it has: clean aligned text + named
`transliteration_scheme`; comprehension titles (no "Chapter N"); structured `citation_scheme`;
`glossary.json`; `school` + `form` + `period` + `tradition_period`; a non-boilerplate
description (heuristic: differs from the boilerplate template and names the school or form);
`cover.webp`; `wiki/`. CI-fail on any miss across `gretil-root` works.

## Risks / open questions

- **Tradition-period vocabularies** need scholarly care and will grow as civilizations are added.
- **Gloss auto-link false positives** — mitigated by romanized-term distinctiveness; needs a
  stop-list for any term that is also a common English word.
- **Covers for abstract philosophy** — the existing agentic pipeline handles series; a darśana
  series keeps them coherent.
- **Generalize now or later?** The facets are designed corpus-wide but only populated for the 31
  here; rolling them across the full 1,836-work corpus is a follow-on, not this spec.
- **Live `era` mismatch** (ingester "Medieval" vs deployed "Ancient") must be reconciled during
  Phase 1's re-run.

## Out of scope

- Non-GRETIL corpus remediation (separate corpus-doctor effort).
- Upstream give-back (GRETIL clean-TEI / Perseus PRs).
- Full-corpus rollout of the semantic facets beyond the 31 GRETIL works.
