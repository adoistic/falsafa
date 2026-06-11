---
status: ACTIVE
---

# Reader/engine split, the Naql atlas, and the first Perseus tranche

Drafted 2026-06-11. Scope set by Adnan: make Naql part of falsafa.ai as its
theoretical justification; separate the reader-centric site from the technical
artifact; merge everything in the naql repo into falsafa; get Perseus
already-translated works into search using the existing methodology. This doc
locks the shape; it extends, and does not replace, falsafa-perseus-launch.md.

## 1. The problem with the current front end

The site serves two different visitors with one surface. A reader who wants
Iqbal or the Manusmriti lands on a homepage that also pitches MCP installs,
eval methodology and ablation charts. The technical story (the launch artifact:
/thesis, /eval, /numbers, /try) is excellent and must not move URLs, but it
currently is the site rather than a wing of it.

## 2. Locked decisions

### 2.1 Two surfaces, one site, no broken URLs

- **Reader surface (default):** `/`, `/works`, `/authors/*`, `/eras/*`,
  reading pages, `/about`, plus the new `/atlas`, `/book`, and `/perseus`
  (when it ships). Header nav: Library · Authors · Eras · Atlas · Book ·
  About, with one quiet right-aligned link: "Engine room".
- **Engine surface:** new hub at `/engine/` introducing the technical
  artifact, linking the existing pages at their existing URLs: `/thesis`,
  `/eval`, `/numbers`, `/try`, MCP install, methodology, accessibility.
  Engine pages get an engine variant of the header (Engine: Thesis · Evals ·
  Numbers · Try · MCP, plus "Back to the library"). No URL changes anywhere.
- **Homepage reimagined reader-first:** the library is the hero (featured
  works, eras, search). One restrained section near the foot: "Why this
  library exists" (links to /book and /atlas) and "How it works under the
  hood" (links to /engine). The current homepage's technical pitch moves to
  /engine.
- Implementation: a `surface` prop on the Base layout (`reader` | `engine`)
  selecting the nav variant. Design tokens unchanged (DESIGN.md governs).

### 2.2 The atlas and the book are the justification layer

- The Naql dataset (six JSON collections, Zod schema, integrity validator)
  moves into the repo at `atlas/` (data + validation), with the naql repo
  remaining the standalone upstream. The site renders it at `/atlas/*`:
  index, work chains (stemma renderer), carriers, places, languages,
  timeline, sources. Components are ported from naql and re-skinned to
  falsafa tokens: terracotta accent in place of lapis for interactive
  elements; the confidence seals keep their own semantic colors (gold leaf
  attested, outlined probable, madder disputed) defined per theme; language
  hues stay data-driven from atlas/data/languages.json.
- The book, Carried Across: how ideas travel, moves in at `book/manuscript/`
  and renders at `/book/*` (reading edition) and `/book/print/` (typeset
  edition; pipeline ported from naql with its known fixes). It gains an
  **afterword: "Why Falsafa"**, written for this merge: the book's argument
  (knowledge survives only when carried; carriers must be named; the new
  readers are machines) is stated as the explicit reason falsafa exists, with
  the librarian-not-LLM design as the isnad discipline applied to a living
  library.
- Cross-linking, so the justification is "everywhere": homepage section,
  /about, /thesis lead-in ("the historical argument behind this design"),
  /engine hub, atlas index ↔ book, book preface ↔ falsafa, README, and a
  note in the naql repo pointing here.
- Agent surface: the atlas .md siblings and /api/graph.json port with the
  routes. MCP tools for chains (list/trace) are **phase 2**, after site
  merge, because @falsafa/mcp is a published package and tool changes ride a
  version bump that Adnan approves.

### 2.3 Perseus, first tranche, existing methodology

- Mechanism (locked by the existing eng review): Perseus English translations
  enter the corpus as ordinary works. Pipeline: a fetcher pulls TEI XML for a
  curated list of CTS URNs from PerseusDL canonical-greekLit/canonical-latinLit;
  a converter flattens TEI to chapters of plain markdown paragraphs; records
  are emitted in the RawWork shape of scripts/convert.ts, with audit entries
  for corpus-audit.json; the existing convert step regenerates the corpus
  deterministically (slugs keyed on stable UUIDs, paragraph IDs content-hashed).
- Input layout: Perseus records live in `perseus-works.json` +
  `perseus-audit.json`; convert.ts learns to read the optional second pair and
  append. works.json (20.8 MB, the 37 curated works) is not rewritten.
- First tranche (this build): a curated core of Greek and Latin works in
  English translation, in the spirit of the catalog (philosophy first):
  Plato, Aristotle, Homer, Herodotus, Thucydides, Aeschylus, Sophocles,
  Euripides, Lucretius, Cicero, Virgil. Exact list pinned in
  `scripts/perseus/tranche-1.json` after verifying which URNs carry usable
  English TEI. Translator and license (CC BY-SA from the Perseus encodings;
  most underlying translations public domain) recorded per work in
  frontmatter `translator` and `source_url`.
- Search: nothing new needed on the site; Pagefind indexes translation
  variants at build, the search dialog picks them up. MCP search_corpus scans
  the corpus directory and picks them up on the next package refresh. SQLite
  FTS5 (per the locked eng review) remains the scale plan for the full
  ~1,500-work archive, not this tranche.
- Wiki cards and cross-links for the tranche: run the existing build scripts
  if their runtime stays sane at +20 works; otherwise defer and note in
  TODOS.md (the wiki doc already anticipates moving wiki out of repo at
  Perseus scale).

## 3. Order of work

1. Branch `feat/reader-engine-split-atlas` (never push; main auto-deploys).
2. IA split (surface-aware header, /engine hub, homepage rework).
3. Atlas port (data, lib, components, routes, md siblings, graph.json).
4. Book port + afterword + cross-links everywhere.
5. Perseus pipeline + tranche ingest + build + search verification.
6. Full verification (build, both surfaces, evals untouched), adversarial
   review pass, incremental commits.

## 4. Out of scope here

Remote MCP deployment, eval scoring rework, the arXiv preprint, full-archive
ingestion, /perseus showcase art. They stay on their own plans.
