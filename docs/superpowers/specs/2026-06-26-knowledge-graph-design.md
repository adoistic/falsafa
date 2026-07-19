# Falsafa Knowledge Graph — Design Spec

_Author: Adnan · 2026-06-26 · Status: draft for review_

A grounded, interpreted, citation-linked graph over the corpus: every work, author, figure,
group, and idea becomes a node; every framing, citation, and interpretation becomes a typed
edge that resolves to source paragraphs. Built on the text + paragraph-id layer we already
have; independent of the metadata backfill.

## Goal

Turn the corpus from a shelf of texts into a **queryable graph of how the canon talks to
itself** — who frames whom, who cites whom, who interprets whom — with every edge anchored to
verbatim passages, and a clean separation between *what a text says* and *what we (or an AI)
read into it*. The graph is also a high-quality substrate for AI retrieval and grounded
reasoning, precisely because of that separation.

## What's already proven (two spikes)

The extract → resolve → verify → render loop was run on two unrelated corpora:
- **Group framing** — the Śūdra across Manu / Yājñavalkya / Parāśara (shared logic, one
  divergence; 8/9 sampled citations verbatim).
- **Figure/group framing on the West** — the racialized "African" across Clarkson, Charles
  Comte, *Applied Eugenics*, and Frederick Douglass (a heredity-vs-circumstance debate; 8/8
  display quotes verbatim; author homonym-split Charles≠Auguste; entity split racial≠geographic).

Both surfaced **citation edges as a byproduct** (Parāśara→cites→Manu, an edge between two works
we hold; Clarkson→Peckard; Eugenics→Pearson; Comte→Humboldt). The graph is already forming.

## Core principle: layered epistemics

Three layers, kept strictly separate, each pointing down to the one below:

1. **Ground (facts).** What a text actually says — verbatim spans, each carrying a `p-xxxxxx`
   paragraph id. Verifiable, deterministic to locate, never paraphrased silently.
2. **Structure (resolved entities + edges).** Canonical nodes and typed edges derived from the
   ground layer. Each edge cites the ground passages it rests on.
3. **Interpretation.** The analytical read — AI's or a human's — *labeled as interpretation*,
   anchored to the passages it interprets, and stamped with provenance (model + version, or
   author) and revisable. Interpretation never masquerades as fact.

This boundary is the whole game. It is what preserves the trust that grounding buys, and what
makes the graph good **AI fuel**: a downstream model receives high-trust facts it can cite and
clearly-marked interpretations it can weigh or override — the signal an ungrounded scrape can't
give it.

## Node types

- **Work** — canonical, disambiguated.
- **Author** — canonical, disambiguated (Charles ≠ Auguste Comte; the two Āryadevas as distinct
  records). Identity, not bare name.
- **Figure** — a person *portrayed or discussed* in texts (Socrates, Napoleon, Manu). A figure
  who wrote nothing exists only as the sum of how others drew him.
- **Group** — a collective the texts characterize (caste, race, class, sect).
- **Idea / Concept** — a notion treated as an object of discussion (dharma, daṇḍa, liberty).
- **ReferencedWork / ReferencedAuthor (external)** — a target named in the corpus but **not held
  in it**. These accumulate into a ranked acquisition list.

## Edge types

All edges are typed, carry a stance/polarity where applicable, and cite the ground passages.

- **frames** — Work → (Group | Figure | Idea): how the text characterizes the entity, with a
  framing summary + stance + mentions. (The reception layer — proven.)
- **portrays** — Work → Figure: the figure-reception sub-type; a figure's page is the inverse
  view, one person ← every text that drew them.
- **cites / quotes / refers-to** — Work → (Work | Author | ReferencedWork): an explicit
  reference, with the citing passage(s), a stance (endorse / refute / extend / invoke-as-
  authority), and — when the target is in corpus — resolution to the cited passage.
- **rebuts / responds-to / extends / influenced-by** — Work ↔ Work, Author ↔ Author: debate and
  influence (Eugenics → rebuts → the environmentalist thesis; Plato → answers → Aristophanes on
  Socrates).
- **interprets** — Author/Work → Author/Work: *how X reads Y* (see below).
- **relates-to** — Figure ↔ Figure: how people relate as portrayed.

## The citation layer (build first)

Most explicit, highest precision, highest ROI. Three cases for a reference's target:

1. **In corpus → internal edge.** Resolve to the work node and, where possible, to the **exact
   cited passage**. This unlocks: traversal, bidirectional "cited-by" backlinks on the target's
   page, and **fidelity-checking** — put the citing line beside the cited line and see whether
   the author represented the source accurately (e.g. Parāśara's "thus Manu declared" next to the
   actual Manu verse).
2. **Not in corpus → external node + acquisition list.** A "referenced-but-absent" node, ranked
   by how often the canon points at it. The graph generates its own ingestion roadmap.
3. **Ambiguous target → resolution** via the same C2 machinery (alias-merge + homonym-split);
   unresolved targets are flagged for review, not guessed.

## The interpretation layer

Two distinct things, both first-class, both governed by the layered-epistemics rule:

- **Generated interpretation (our/AI's reading).** Per node or edge: synthesis, significance,
  connections, "what this argument does." Rich notes that read like a sharp scholar (human voice;
  anti-AI-tell discipline; neutral, non-moralizing). Each note is anchored to the passages it
  interprets and stamped with provenance and a timestamp; it is revisable and never merged into
  the ground layer.
- **Interpretation edges (how X reads Y).** The richest relationship in a philosophy corpus,
  because the commentary traditions (bhāṣya / ṭīkā / vṛtti; scholastic and modern commentary) are
  interpretation. Live in-corpus case: Abhinavagupta's *Paramārthasāra* is a Śaiva re-reading of
  **Ādiśeṣa's** *Paramārthasāra* (both held; the glossary already notes the base *ādhārakārikā*).
  "How Abhinavagupta interprets Ādiśeṣa," grounded in both texts, is an edge we can draw.

Interpretation may stack (an AI interpreting a commentator's interpretation of a root text), as
long as each level keeps its own citations and provenance.

## Pipeline (mirrors the proven spike)

- **C1 — extract** (per work, grounded): framings (groups/figures/ideas), explicit references
  (citing passage + stance + raw target string), and human-voice summaries/key-points as a
  byproduct. LLM-driven, citation-grounded, neutral. Generated interpretation is produced as a
  separate, labeled artifact — never folded into the extracted facts.
- **C2 — resolve** (corpus-scale): canonicalize entities *and* citation targets into nodes; merge
  aliases, split homonyms; classify reference targets as in-corpus / absent; resolve in-corpus
  citations to passages where possible. Each merge records its basis. Human-reviewable.
- **Verify**: adversarial check that every displayed quote is verbatim and supports its claim,
  and that each in-corpus reference resolves to the right target; report a grounding rate.

## Views (the payoff surfaces)

- **Entity page** (group / idea): framings across works (proven mock).
- **Figure page**: a person's distributed reception — "how the canon constructs X," contradictions
  visible, each author's hand cited.
- **Work page**: what it frames, what it cites (outbound), and **who cites it** (inbound backlinks).
- **Graph / influence view**: traverse cites / rebuts / influenced-by / interprets; reconstruct a
  debate or an influence chain.
- **Acquisition list**: ranked referenced-but-absent works (an ops/roadmap surface).
- **Fidelity view**: an in-corpus citation shown beside the passage it cites.

## Relationship to existing layers

Builds on the text + paragraph sidecars (already present, so it runs on works we hold without
waiting on the metadata backfill). Complements the deterministic statistical wiki (`build-wiki`)
and the metadata standard (school/form/period/glossary — separate spec). The graph is the
semantic/relational layer those two don't provide.

## Verification, reproducibility, provenance

LLM extraction is non-deterministic, unlike the wiki. Mitigations: version and cache every
generated artifact; stamp each with model + version + timestamp; adversarially verify the
ground-layer citations (the deterministic part); keep interpretation revisable and clearly
secondary. Auditability comes from the rule that every edge and every interpretation points down
to cited passages.

## Phasing

- **Phase 0** — schema (node/edge/provenance store), the C1→C2→verify skeleton, on one bounded
  pilot cluster (e.g. the smṛti set we already extracted).
- **Phase 1** — **citation layer** corpus-wide: extract references, resolve in-corpus vs absent,
  build the citation + influence graph, work backlinks, the acquisition list, the fidelity view.
- **Phase 2** — framing layer (groups / ideas): entity pages.
- **Phase 3** — figures: figure-reception pages.
- **Phase 4** — interpretation layer: generated notes + interpretation edges; debate / influence
  traversal UI.

Each phase is its own extract → resolve → verify → surface cycle and its own implementation plan.

## Sensitivity / editorial

Neutral representation-history throughout: describe the text's stance, cite it, do not moralize.
Charged material (caste, race, slurs) is handled as cited historical evidence, not reproduced
gratuitously (the Douglass extraction's slur-in-context handling is the model). Generated prose
follows the anti-AI-tell discipline and is researched before anything is public-facing.

## Risks / open questions

- **Extraction cost** at 1,836-work scale → phase, cache, and prioritize the citation layer
  (cheapest, most explicit) first.
- **Resolution precision** — false merges/splits are the core risk; the two-Āryadevas case is the
  cautionary example. Provenance + human review on merges.
- **Passage-level citation resolution** accuracy (matching "Manu declared X" to the right verse).
- **Non-determinism** → versioning + provenance; decide the human-in-the-loop ratio per layer.
- **Storage + serving** — where the graph lives and how it integrates with the site and the MCP.
- **Interpretation governance** — how much AI-generated interpretation ships unreviewed, and how
  it's visibly distinguished from fact in the UI.

## Out of scope

- The GRETIL metadata completeness backfill (separate spec).
- Production storage/serving details and full UI design (later plans).
