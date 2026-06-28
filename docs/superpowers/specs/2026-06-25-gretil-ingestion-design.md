# GRETIL Ingestion — Design Spec

_Author: Adnan · 2026-06-25 · Status: draft for review_

## Goal

Add the **Indian philosophical canon** to Falsafa by ingesting source texts from
GRETIL (Göttingen Register of Electronic Texts in Indian Languages), cleaning and
chapterizing the Sanskrit, and producing in-house English translations — using the
same proven model as the existing Indic works and the Perseus Tranche-2 grind.

GRETIL is a proven source: the corpus's existing Sanskrit works (Manusmṛti and the
other smṛtis) already came from GRETIL, cleaned with an agentic Claude workflow.

## Scope (decided)

**In:** the philosophical canon —
- Six darśanas: Nyāya (Gautama Nyāyasūtra), Vaiśeṣika (Kaṇāda), Sāṃkhya
  (Sāṃkhyakārikā, Sāṃkhyasūtra), Yoga, Mīmāṃsā (Jaimini), Vedānta (Bādarāyaṇa
  Brahmasūtra + commentaries)
- Principal Upaniṣads, Bhagavad-gītā, Brahma-sūtra
- Buddhist philosophy (Nāgārjuna corpus — MMK etc., Asaṅga, Maitreya, Candrakīrti,
  Dharmakīrti, Dignāga), Jaina philosophy/logic
- The major commentaries (bhāṣyas) on the above

**Out:** dharmaśāstra/smṛti (already in corpus), ritual, grammatical, medical,
astronomical, and purely literary texts — the bulk of GRETIL.

Inventory: the GRETIL TEI mirror has 784 Sanskrit files; ~129 match the philosophy
set. (Source: `github.com/mmehner/gretil-corpus-tei`, cloned to
`t2work/gretil/gretil-corpus-tei`, CC BY-NC-SA 4.0, IAST/Unicode.)

## Key finding — structure is heterogeneous (empirically verified)

GRETIL's "the TEI is structured" claim is unreliable per-file. Four archetypes seen:

| Text | Division lives in | Noise |
|------|-------------------|-------|
| Mūlamadhyamakakārikā | clean `<div>`+`<lg>` (27 ch) | minimal |
| Sāṃkhyakārikā | nothing (flat `<l>`, single work) | inline footnote digits, `^ . \` '` sandhi notation |
| Nyāyasūtra | the `1.1.1:` number prefix in `<p>` | GRETIL boilerplate `<p>`, `{}`/`[]` labels |
| Nyāyasūtra-bhāṣya | text banners `**NySBh_1,1.1**`, *unlabeled* `<div>` | `% p.N` page markers, sūtra/bhāṣya separation |

**Consequence:** a pure deterministic parser is not viable. Chapterization must be
**per-text and Claude-driven**, with deterministic pre-cleaning of invariant noise.

## Target output format (matches existing corpus)

Per work: `corpus/works/<slug>/index.md` + per chapter
`chapters/<NN-title>/{transliteration.md, translation.md, *.paragraphs.json, meta.json}`.
Sanskrit lives as **`transliteration.md` (IAST)**; English as `translation.md`
(`translator: thothica`). No Devanāgarī `original.md` (mirrors existing smṛti works).

## Pipeline (per text)

0. **Comprehension first** (one subagent per text, FULL text in context): read the
   whole file and report real identity, actual transliteration scheme, genuine
   canonical structure + where boundaries fall (or none), and what is noise vs text.
   Do NOT trust the TEI markup or GRETIL header claims (often wrong: headers claim
   IAST when the text is Velthuis; `<div>`s merge/omit chapters; word-indexes and
   editorial captions masquerade as text). Decisions come from understanding content.
1. **Execute the understood cleaning** (tooling, post-comprehension + verified): strip
   teiHeader, non-text divs (word-indexes), reference IDs/banners/labels, apparatus
   notes + their inline pointer digits, page markers. **Preserve each document's
   source transliteration scheme as-is — NO conversion** (Velthuis stays Velthuis,
   IAST stays IAST; record `transliteration_scheme` in metadata). Segment by the
   embedded reference number, never by TEI tags.
2. **Derive the ontology + chapterize** per the comprehension: by READING the content,
   build the text's true *logical* structure — titled chapters/sections reflecting the
   actual argument (e.g. the Sāṃkhyakārikā's thematic arc; MMK's 27 named examinations).
   This derived ontology drives the UI chapterization. Do NOT inherit GRETIL's mechanical
   separation. Output per-chapter `transliteration.md` (source scheme preserved) +
   paragraph alignment; keep pūrvapakṣa/siddhānta role tags as metadata; split multi-work files.
3. **Claude translate** (Sanskrit→English), terminology-preserving: the Perseus-T2
   rolling-context pipeline, but **key technical terms are KEPT intact and tagged**
   (not flattened to lossy English) using a per-work term glossary. Convention:
   `{{term:puruṣa|the conscious witness/self}}` inline in `translation.md`, rendered
   by the UI with a gloss; a `glossary.json` per work holds term→definition. Terms are
   derived per text in step 2. For cryptic root-sūtras, render the *established* sense
   (commentary-informed) with elliptical additions in `[brackets]`.
4. **Integrate** via `scripts/gretil/ingest.ts` (same shape as `scripts/perseus/`),
   emitting `gretil-works.json` + `gretil-audit.json`; convert regenerates corpus.
5. **Verify**: verse/sūtra-number continuity, transliteration↔translation paragraph
   alignment, IAST validity, chapter counts vs source.

## Canonical clean-TEI intermediate (dual-purpose)

The cleaning stage emits a **clean canonical TEI** as the heart of the pipeline.
Everything derives from it:
- Falsafa corpus files (`transliteration.md` / `translation.md`), and
- the upstream-contributable artifact: a corrected clean TEI to offer **GRETIL**
  (Phase 2 — give-back; not pushed now).

This makes "improve the schema" fall out of the cleaning we're doing anyway.

## Tranches

- **T1 — foundational primary texts:** 6 darśana root-sūtras + Sāṃkhyakārikā +
  Brahma-sūtra + principal Upaniṣads + Bhagavad-gītā + Nāgārjuna MMK.
- **T2 — major commentaries** (bhāṣyas/vṛttis on the T1 roots).
- **T3 — widen** within the philosophical set.

## Risks

- Sanskrit philosophical translation is genuinely hard (technical vocabulary,
  commentary traditions, sandhi) → mitigated by the fixed glossary/brief + review pass.
- Per-text structural variance → mitigated by Claude-driven chapterization.
- Transliteration-scheme normalization (IAST variants, inline markers) → pre-pass.

## Out of scope (this spec)

- Phase 2 upstream give-back (GRETIL clean-TEI offer; Perseus PRs — already staged
  separately) and Phase 3 (GRETIL site redesign offer).
