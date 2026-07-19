# Atlas Rebuild — Data Inventory & Reference Note

**Status:** Context-gathering only. No UI design, no build decisions here.
**Date:** 2026-07-19
**Purpose:** Put *exactly what data we have* (falsafa ontology harvest) and *exactly what Indian Liberals has* side by side in one place, so the atlas rebuild can be designed from ground truth.

The atlas rebuild is **greenfield**. The existing `atlas/` dataset and `apps/site/src/pages/atlas/*` are a hand-curated placeholder (~40 people, a few dozen Graeco-Arabic transmission records) and are to be **discarded**, not migrated. See Part D for what's being bulldozed.

Everything below is measured from the live harvest as of this date, not from memory. Numbers will grow as harvesting continues (currently ~16% of windows done).

---

## Part A — What Falsafa has (the harvest)

### A.1 The corpus underneath it

The ontology is extracted over a real, reader-facing corpus:

| | Count |
|---|---|
| Works | 2,018 |
| Authors | 622 |
| Languages | 9 (greek, latin, sanskrit, english, french, urdu, kawi/Old Javanese, old-english, german) |
| Eras | 12 (Classical, Imperial, Hellenistic, Late Antiquity, Ancient, Renaissance, Medieval, Enlightenment, 16th–20th Century) |
| Genres | 34 (Classics, Philosophy, Poetry, Political Theory, Economics, Law, History, Rhetoric, Logic, Vedic Literature, …) |

Source: `neondb + Perseus Digital Library tranche`. Manifest: `corpus/manifest.json`.

Each work is split into **chapters**, each chapter into **paragraphs with stable ids** (`p-623d90`). Every ontology claim anchors to one or more of these paragraph ids — this is the spine of the whole system (see A.4). A work is processed as a set of **windows** (`work-slug-partNNN`); the full archive is **12,797 windows**.

### A.2 The ontology data model (four record types per window)

Each processed window emits one JSON document (`ontology_version: "anchor-range-v1"`) with four collections. Schema source of truth: `scripts/graph/ontology-production-run.ts`.

**Entity** — a named thing in the text.
```
canonical_name   string
surface_names    string[]         // every surface form used in the text
kind             figure | group | idea | place | event | object | animal
figure_kind      historical | mythological | deity   // only when kind=figure
description       string           // what it is, grounded in this work
justification     string           // why it was extracted
evidence          Evidence[]       // anchored, see A.4
```

**Theme** — a topic/motif the passage engages.
```
topic            string
implicit         boolean           // stated outright vs. enacted/implied
evidence         Evidence[]
justification    string
```

**Citation** — an edge to another work and/or author the text engages.
```
cited_work       string            // "" if only an author is named
cited_author     string            // "" if only a work is named
stance           authority | endorse | refute | extend | neutral
evidence         Evidence[]
justification    string
```

**Quote event** — a speech/quotation act in the text.
```
kind             direct_quote | reported_speech | citation_quote
speaker          string?           // who utters it (in-text)
quoted_person    string?
quoted_work      string?
quoted_author    string?
stance           authority | endorse | refute | extend | neutral   (optional)
source           "manual"
evidence         Evidence[]
justification    string
```

**Ingest defensively (validator drift).** The runtime validator is looser than the published JSON Schema: it checks required keys, the anchor XOR rule, real paragraph ids, and the figure/figure_kind pairing, but does *not* enforce the `kind`/`quote_event.kind` enums or reject extra keys. So the on-disk data carries a little off-schema noise — `kind:"deity"` as a top-level 8th kind, `quote_event.kind:"accusation"`, stray keys (`evidence_note`, `implicit`, `quoted_person_kind`). Treat the enums above as canonical, but **read tolerantly** and take grounding **only** from `evidence[].expanded_paragraph_ids` and `evidence[].quotes[]`.

### A.3 Two graphs already live in this schema

The schema is not a flat tag list — it's **two overlapping graphs plus two rich node sets**:

- **Citation graph** (`citations`): `work → work` and `work → author`, *typed by stance* (does this text treat the source as authority, endorse it, refute it, extend it, or cite it neutrally). This is a genuine bibliographic/intellectual-influence graph. Indian Liberals only has an embryonic `work → thinker` mention edge; we have `work → work` **and** stance.
- **Engagement graph** (`entities` + `themes`): `work → entity` and `work → theme`, where entities span **7 kinds** — not just people. A place, an idea, a social group, an event, an object, an animal are all first-class nodes.
- **Quotation layer** (`quote_events`): who quotes/speaks what, typed (direct / reported / citation), with speaker and quoted-source attribution.

### A.4 The evidence & anchoring system (the discipline)

Every claim in every collection carries an `evidence[]` array. Each evidence object:
```
anchor_type            paragraph_ids | paragraph_range   (XOR — never both)
paragraph_ids          string[]                          // e.g. ["p-735215"]
paragraph_range        { start, end }                    // an ordered span
evidence_hint          string   // human-readable pointer to what's in the passage
role                   string   // the semantic role this evidence plays
expanded_paragraph_ids string[] // filled at enrichment
quotes                 EvidenceQuote[]  // filled at enrichment — the VERBATIM text
```

A two-phase design keeps quotes exact:
1. **Extraction** (Sonnet subagent) returns anchors + hints only — *never* verbatim quotes.
2. **Enrichment** (deterministic, local) attaches the exact quote pulled from the anchored paragraph:
```
EvidenceQuote = { paragraph_id, quote, selection_method, selection_score }
   selection_method: terms_sentence | paragraph_fallback
```

**Consequence:** every entity, theme, citation, and quote in the graph is **click-through-able to the exact paragraph in the reader**, with the verbatim sentence already selected. Nothing is asserted without a locatable, quotable anchor. This is Indian Liberals' "no edge without a quote" rule, but enforced structurally and at paragraph precision across ~275k evidence objects.

### A.5 What's actually been harvested so far (measured)

At **2,054 / 12,797 windows (16.1%)** done — 514 works fully complete:

| Collection | Count |
|---|---|
| **Entities** | 107,575 |
| **Themes** | 20,144 (16,093 explicit / 4,051 implicit) |
| **Citations** | 16,721 |
| **Quote events** | 41,109 |
| **Evidence objects** (anchored) | 275,406 |

> These are a **dated snapshot**. The live counts come from the freshness beacon (A.11): at 2026-07-19 09:09 UTC it read **2,070 windows · 108,466 entities · 20,276 themes · 16,943 citations · 41,488 quote-events · 277,712 evidence**, and it climbs on its own as harvesting continues. **Never hardwire these numbers — read them.** (An older local mirror can lag — the on-disk `windows/` copy was at 1,558 while R2 was at 2,070.)

**Entity kinds:**
| kind | count |
|---|---|
| figure | 44,712 |
| group | 16,269 |
| idea | 15,127 |
| place | 14,579 |
| event | 8,375 |
| object | 6,805 |
| animal | 1,707 |

Figure sub-kinds: historical 28,392 · mythological 9,389 · deity 6,930.

**Citation stance** (citations + quote_events): authority 21,154 · neutral 11,341 · refute 5,211 · endorse 2,309 · extend 2,280.

**Quote-event kinds:** citation_quote 17,320 · direct_quote 12,928 · reported_speech 10,860.

**Anchor types:** paragraph_ids 218,117 · paragraph_range 57,289.

### A.6 The richness beyond people — this is the "100x" point

Indian Liberals captured *thinkers* (people) and *themes*. Falsafa captures a whole ontology, and the non-person nodes are where the new experiences live:

**Ideas / concepts / abstractions** (`kind: idea`, 15,127) — the intellectual-history layer. Top concepts already present:
`justice (109), virtue (71), democracy (55), philosophy (54), tyranny (52), wisdom (46), oligarchy (38), dharma (37), fortune (37), courage (34), pleasure (30), friendship (29), law of nature (26), temperance (26), freedom (25), trial by jury (23), the soul (23), fate (23), common law (21), law of nations (21), slavery (21), individualism (16), ṛta (16), liberty (16)…`
These cross languages and eras — *dharma* and *ṛta* sit alongside *natural law* and *common law*. A concept page ("everywhere justice is argued, across 2,000 years") is a thing only this data can do.

**Groups — peoples, castes, races, factions, institutions** (`kind: group`, 16,269) — exactly the "particular caste / particular race" abstractions called out. Top groups:
`Athenians (240), Lacedaemonians (192), Persians (115), Greeks (111), Romans (98), Thebans (93), Achaeans (90), Trojans (74), Maruts (72), Egyptians (71), Barbarians (66), Stoics (53), Ādityas (53), slaves (50), the Church (46), Roman Senate (45), House of Lords (42), House of Commons (41), Jews (39)…`
Note the mix: ethnic/national peoples, religious groups, philosophical schools (Stoics), legislative institutions (House of Lords), social categories (slaves), Vedic divine collectives (Maruts, Ādityas). This is a social-ontology layer Indian Liberals never had.

**Places** (14,579), **events** (8,375), **objects** (6,805), **animals** (1,707) — each a first-class, anchored, cross-referenced node.

**Themes** (20,144) run from the literary (`homecoming (nostos)`, `hospitality (xenia)`, `grief and mourning`, `reversal of fortune`, `kleos`) to the legal/philosophical (`proportionality of punishment`, `proof by contradiction`, `immortality of the soul`, `virtue as the sole good`, `ritual purity and pollution`).

### A.7 The citation graph, concretely

Most-cited **works**: `Iliad (87), Psalms (81), Genesis (54), Odyssey (49), Gospel of Matthew (49), Blackstone's Commentaries (44), Epistle to the Romans (41), Twelve Tables (40), Gospel of John (40), Digest (37), Histories (35), Isaiah (34), Acts (32), Institutes of Justinian (30)…`

Most-cited **authors**: `Euclid (406), Homer (402), Plato (293), Paul (217), Aristotle (175), Cicero (169), Euripides (169), Epicurus (153), Moses (180), Solon (90), Chrysippus (90), Hesiod (83), Justinian (119)…`

This already spans the classical, biblical, and legal canons and their cross-references — the raw material for "what has this work engaged with / what has this author engaged with / who engages *them*."

### A.8 Harvest progress (what kind of data is done)

**By language:** Greek 402/810 (50%) · Sanskrit 26/26 (100%) · Kawi 9/9 (100%) · Latin 56/387 (14%) · English 21/766 (3%) · French/Urdu/Old-English/German 0%.

**By era:** Classical 99% · Ancient 100% · Late Antiquity 25% · Imperial 16% · Hellenistic 6% · modern (18th–20th c.) ~1–5%.

**By genre:** Law 100% · Vedic Literature 100% · Philosophy 47% · Classics 40% · Poetry / Political Theory / Economics / Political Economy / Social Theory ~0%.

The mature clusters today are the **Greek classical core + the entire Indic/Vedic set + Roman law**. The modern English political-economy corpus is essentially untouched.

### A.9 Where the data lives

- **The corpus (denominator, git-tracked):** `corpus/manifest.json` — all works/authors/eras + `counts`; the full set of 2,018 works / 12,797 windows the harvest draws from.
- **Raw per-window output:** `corpus/graph/ontology-runs/2026-07-02-sonnet-benchmark/responses/*.response.txt`
- **Enriched (quotes attached):** `.../windows/*.enriched.json` — the files the atlas reads.
- **Progress-of-record: Cloudflare R2**, `r2:falsafa-ontology-runs/…`, mirrored to a public r2.dev URL (see A.11). The `windows/`, `responses/`, `prompts/`, and `window-manifest.json` are **gitignored** — R2 is authoritative, local disk is only ever a partial mirror.
- **Already-aggregated but STALE:** `corpus/graph/{citation-graph.json, figure-index.json, quote-events.json, acquisition-list.json, stats.json}` — a *prior* synthesis over only **~15–20 works** (`citation-graph.json` = 351 nodes / 420 edges; `figure-index.json` = 468 figures; `acquisition-list.json` = a ranked list of not-yet-in-corpus targets the graph most wants next). These are far behind the current 2,000+-window harvest and on an earlier schema — **regenerate from the full harvest; do not trust the checked-in copies.** (`acquisition-list.json`'s ranking logic is itself worth reusing as an auto-signal for what to acquire next.)
- **Schema/pipeline:** `scripts/graph/ontology-production-run.ts`, `scripts/graph/ontology-sonnet-production.ts`.

### A.10 The node model — what is a node, and what is not (yet)

Before designing anything, be exact about what has a **stable identity** today versus what is still just a per-window string. The data is currently **work-anchored**: every extraction lives inside one work and points at that work's paragraphs. **A global entity graph does not exist yet — it has to be synthesised** (A.11 / Open threads).

**Stable nodes (canonical id today):**
- **Work** — `work_slug` (e.g. `a-v-dicey-lectures-...-340c4e`), from `corpus/manifest.json`. Git-tracked, reader-addressable.
- **Author** — author slug in the corpus manifest. Git-tracked.
- **Paragraph** — `p-xxxxxx`, stable and reader-addressable; the anchor every claim resolves to.

**Proto-nodes (extracted, but NOT yet resolved into nodes):**
- **Entity** (7 kinds; ~108k *pre-merge*) — keyed only by `canonical_name` + `surface_names` **within a window**. The same person/place/idea recurs across thousands of windows as independent rows; naive dedup already collapses ~48%, and alias- + transliteration-aware merging collapses more.
- **Theme** (~20k; ~99% unique surface) — free-text topics, essentially unclustered.

**The identity problem (the precondition for the atlas).** One real figure can appear as up to **five unlinked representations**: a `figure` entity's `canonical_name`, a `cited_author` on a citation, a `quoted_author` on a quote-event, an author slug in the corpus manifest, and (if in-corpus) the author of a work. Unifying these into one node — across languages and transliterations (Ζεύς / Zeus, Ṛgveda / Rig Veda) — is the **entity-resolution pass, and it is unbuilt.** The same holds for clustering themes, and for deciding when a `cited_work` string is one of our 2,018 works versus an external reference.

**Edges we have today (all work-anchored, all evidence-backed):** `work → cited_work` and `work → cited_author` (stance-typed), `work → entity` (mention), `work → theme` (engagement), and `quote_event` (an in-work speech/citation act). What's missing is not evidence — every edge already carries paragraph-anchored verbatim quotes — it is **entity identity**: turning work-anchored proto-nodes into resolved cross-work nodes so the edges connect into a real graph.

### A.11 Staying current — source of truth & the auto-update contract

The system must assume the data **only grows**, and update itself with no hardwired snapshot. There are **two independent growth vectors**, each with its own detectable signal:

1. **Corpus acquisition (new works enter the library).** New works (roadmap: Perseus → GRETIL/Indic → Liberty Fund → Islamic → …) land in `corpus/manifest.json` (git-tracked) and raise the 2,018 / 12,797 denominator. Detect by reading the manifest's `counts` + `works[]` fresh on every build.
2. **Harvest progress (existing works get ontology-extracted).** The live vector, and it is **not in git** — output is written to R2 as progress-of-record; cloud sessions do R2 write-back. Local disk is only ever a partial mirror.

**How we know there is more — the freshness beacon (verified live 2026-07-19):**
- **`production-run-summary.json`**, served publicly at
  `https://pub-88ffad6f37754be2b0e33466951a5135.r2.dev/2026-07-02-sonnet-benchmark/production-run-summary.json`
  — regenerated on every finalize. Read `generated_at` (freshness timestamp), `responses_finalized` / `total_archive_windows` (coverage), and `extraction_volume` (live entity/theme/citation/quote/evidence counts). At check time: **2,070 / 12,797 windows, 108,466 entities** — and rising unattended.
- **`responses-manifest.txt`** (same base) — the flat list of finalized windows; derive `work_slug`s to get the exact harvested-works set. It can lag the summary slightly (1,766 lines vs 2,070 finalized at check time; the two regenerate on different cadences) — treat the summary as the count-of-record and the manifest as the best-available window index.
- **Each `.enriched.json` is individually fetchable** over plain public HTTPS at `.../windows/<window>.enriched.json` — no credentials, no rclone for incremental pulls. **Bucket listing (ListObjects) is not exposed**, so the manifest *is* the index; you cannot enumerate the bucket directly.

**The auto-update loop (a data contract, not UI):** on build (or on a schedule) read the beacon's `generated_at` / `responses_finalized`; if it advanced past the last build, diff `responses-manifest.txt` to find new windows, pull those `.enriched.json`, re-run synthesis (resolve proto-nodes → nodes/edges), and rebuild. The **denominator** comes from the manifests, the **numerator** from the beacon — nothing is pinned to a snapshot, so new works and new harvest coverage flow in automatically.

---

## Part B — What Indian Liberals has (the reference bar)

Repo: `adoistic/indianliberals` (cloned at `/workspace/indianliberals`). A rebuild of indianliberals.in for the Centre for Civil Society, built by Thothica. Astro static site on Cloudflare, Git-based CMS (Sveltia).

### B.1 Content collections (7)
`thinkers`, `organisations`, `musings` (excerpts), `opinions`, `interviews`, `primary-works`, `theprint-mirror` (federated column). Two-tier honesty model: clean content is fully searchable + paragraph-citable; primary-work PDFs surface as **rich AI metadata + summary + link** (paragraph-level citation deferred).

### B.2 Authority files (pre-populated, library practice)
YAML: `content/authority/{thinkers,organisations,publishers}.yaml`. ~462 thinkers + 50 organisations. Extraction maps names against these; unmatched flagged for review. 125 thinkers are `ai_drafted_stub` placeholders awaiting real bios.

### B.3 The AI-extracted metadata layer
Per primary-work PDF: author normalisation, year, themes, publisher provenance, AI summary, key points, pull quotes, and **cross-thinker mentions with verbatim evidence**. ~220 of ~944 PDFs baked at snapshot time.

### B.4 The synthesis graph (the heart of it)
`data/synthesis/graph-edges/` — three typed edge files, each edge carrying `confidence`, `evidence_works`, and a verbatim `context` quote:
- `cites.json` — `work → thinker` (~120 edges)
- `engages.json` — `work → theme` (~372 edges)
- `contributor.json` — `work → author/editor` (~34 edges)

Plus `data/synthesis/cross-links.json` — TF-IDF `related-across-the-archive` links (1,958 computed). Plus `thinker-occurrences.json` / `theme-occurrences.json` aggregations. Total graph: **~526 edges over 40 baked PDFs**.

### B.5 The showpiece UI — the thinker page (three-role model)
`apps/site/src/components/ThinkerDetail.astro`. Each thinker rendered as:
- **By X** — works/excerpts/opinions they authored.
- **About X** — profile pieces / interviews, each with `key_passages` (quote + "what it shows").
- **Mentioned in X** — works referencing them, each with **verbatim evidence quotes + context**.
- **"How X is discussed in this archive"** — synthesis prose aggregating counts + evidence across roles.
- **Themes / affiliations** aside; **"Related across the archive"** (TF-IDF).

The work page (`PrimaryWorkDetail.astro`) shows: AI summary (tabbed against the PDF), pull quotes, themes chips, people-in-piece chips, related section.

### B.6 The agent/machine layer
`.md` sibling on every detail page (~580 files); `/llms.txt` (curated index) + `/llms-full.txt` (4 MB corpus dump); `/AGENTS.md` (citation rules + tier system); planned MCP server at `mcp.indianliberals.in`. Multilingual Pagefind search (English, Hindi, Gujarati, Marathi, Bengali) — 1,225 pages, ~28k words.

### B.7 The core discipline
**No edge without a quote.** Every relationship is both clickable and substantiated by verbatim text. That discipline — not the scale — is what makes it feel authoritative. It is the one thing to carry over wholesale.

---

## Part C — Side by side

| Dimension | Indian Liberals | Falsafa (at 16% harvested) |
|---|---|---|
| Node types | thinkers (people), themes | **7 entity kinds** (figure, group, idea, place, event, object, animal) + themes |
| People | 462 thinkers | 44,712 figure-entities (historical/mythological/deity) |
| Non-person nodes | — | **62,863** (groups, ideas, places, events, objects, animals) |
| Ideas / concepts | — | **15,127** (justice, dharma, natural law, liberty…) |
| Social groups (caste/race/faction/institution) | — | **16,269** |
| Themes | ~202 | **20,144** |
| Citation edges | ~120 (`work→thinker`) | **16,721** (`work→work` and `work→author`), stance-typed |
| Quotation acts | in-prose mentions | **41,109** quote_events (direct/reported/citation), attributed |
| Evidence | quote per edge (stored string) | **275,406** anchored evidence objects, quote resolved to exact paragraph |
| Stance/typing on edges | confidence only | **stance** (authority/endorse/refute/extend/neutral) + confidence-by-construction |
| Corpus scale | ~944 PDFs, 1 tradition, 1 primary lang (+4 search langs) | 2,018 works, 622 authors, **9 languages, 12 eras, 34 genres**, 2,000-year span |
| Reader integration | PDF + summary; paragraph-citation deferred | full paragraph-anchored reader; every claim links to its paragraph |

**Summary:** Indian Liberals is a people-and-themes archive with an evidence-backed mention graph. Falsafa is a full multi-kind ontology with a stance-typed citation graph, a quotation graph, and paragraph-exact evidence — a strict superset in kind, and (already, at 16%) ~30x in edge volume. The "100x" is in the *kinds of nodes and relationships*, not just the counts.

---

## Part D — What exists in falsafa today (to bulldoze / refactor)

Greenfield means these are reference-only; the rebuild does not have to preserve them.

**The placeholder atlas (discard):**
- `atlas/data/*.json` — hand-curated: `languages`, `people` (~40), `places`, `sources`, `transmissions`, `works`. Scope: the Graeco-Arabic translation movement. Small, artisanal, unrelated in shape to the harvest.
- `apps/site/src/pages/atlas/*` — renders that dataset (`ontology.astro`, `works/[id]`, `languages/[id]`, `places/[id]`, `sources`, `timeline`).
- `apps/site/src/components/atlas/*`, `apps/site/src/lib/atlas/*` — Zod schema + render helpers for the placeholder.

**Existing reader/work/author surfaces (refactor targets, not atlas):**
- `apps/site/src/pages/works/[slug]/…` — the actual corpus reader (chapter/variant).
- `apps/site/src/pages/authors/[slug].astro`.
- `apps/site/src/lib/corpus.ts` — corpus access layer.

**Not yet connected to anything:** the ontology harvest output. Nothing in the site currently reads the 107k-entity / 16.7k-citation graph. That connection is the rebuild.

---

## Open threads (for the design phase — NOT decided here)
- **Entity resolution / dedup — the #1 precondition.** Cross-window canonicalisation is unsolved: "Plato" the figure-entity, the cited-author, the quoted-author, the manifest author, and the author-of-works are five unlinked strings today (A.10). Nothing is a real node until this pass exists. Needs an authority-file + blocking/embedding approach with confidence thresholds (Indian Liberals' manual cluster-collapse won't scale); themes need clustering essentially from scratch (~99% unique surface).
- **Global synthesis pass is missing.** The graph is per-window; no pass (à la Indian Liberals' `data/synthesis/`) rolls it up into resolved nodes/edges + indexes. The existing `citation-graph.json` / `figure-index.json` are a **stale ~15–20-work** earlier-schema attempt (A.9) — evolve or rebuild against the full `anchor-range-v1` harvest, don't port them.
- **Auto-update is a solved-but-unwired mechanism (A.11).** The freshness beacon + manifest + per-window HTTPS fetch already exist on public R2. Open question is *where synthesis runs* (in `bun run deploy`? on a schedule? incremental vs full re-aggregate?) and how the site sources from R2 rather than the lagging local mirror — not *whether* we can detect new data.
- **Design for skew + growth.** Coverage is saturated on Greek/Vedic/Roman-law and near-empty on the modern corpus, and rebalances over time (A.8). The atlas must look complete now and degrade gracefully — no page broken because a language/era is at 0% — and assume the graph keeps growing.
- **Ingest defensively.** Read grounding only from `evidence[].expanded_paragraph_ids` / `quotes[]`; tolerate the off-schema `kind`/`quote_event.kind` values and stray keys (A.2).
