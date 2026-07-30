# Full-text search + Atlas tools for the BYOK demo and the installed MCP

**Date:** 2026-07-30
**Author:** Adnan
**Status:** implemented

## Problem

Two gaps, both surfaced by watching the /try demo answer a real question.

1. **The browser demo could not search text.** `search_corpus` in
   `apps/site/src/islands/byok/localMcp.ts` matched only work-level metadata
   (title / author / genre / language / era) and told the model so in a `note`.
   Asked to find passages about Zeus, the model correctly reported that "full-text
   search is limited in this environment" and fell back to reading works one at a
   time — the worst possible retrieval strategy over 2,018 works.

2. **Nothing could reach the Atlas.** The ontology layer — 38,871 entity rows,
   per-work chapter rosters, 12,270 citation edges with stances — was invisible to
   both the demo and the installed MCP, even though it is the most distinctive
   thing in the corpus. And it is *partial*: 357 of 2,018 works processed. Exposing
   it without that fact prominently attached invites a model to read "absent from
   the Atlas" as "absent from the corpus" and tell users a text does not exist.

## What was already there

No new infrastructure was needed for either gap.

- `pagefind --site dist` already runs in `bun run build`, publishing `/pagefind/`.
  Its index covers chapter bodies (`data-pagefind-body` on `.reader-body`), so a
  hit's URL *is* the citation URL grammar. Crucially it records every reader
  paragraph's `id="p-xxxxxx"` as an **anchor with a word location**, and matches
  come back as word locations too — so a match can be resolved to the exact
  paragraph that contains it.
- The Atlas is already published at `/corpus/graph/atlas/` through the
  `public/corpus` symlink: `meta.json` (3 KB, holds the coverage counters),
  `entities-index.json` (6.9 MB raw / **1.32 MB gzipped**), per-entity dossiers
  (~28 KB gzipped each), `works/<slug>.json`, `works-atlas.json` (54 KB gzipped),
  `citations.json` (1.30 MB gzipped).

## Decisions

**Search: use Pagefind's JS API.** Rejected shipping a custom inverted index
(a new multi-hundred-MB artifact duplicating one that already exists and would
need re-syncing as the corpus grows) and a search endpoint on the falsafaai
Worker (breaks the demo's zero-backend premise and its locked `connect-src`).
Cost accepted: Pagefind's stemmed AND matching ranks differently from the
installed MCP's SQLite FTS5.

**Atlas source for the installed MCP: disk if present, else HTTP.** The Atlas is
~64 MB, so it stays out of the corpus release tarball. Resolution order:
`FALSAFA_ATLAS_URL` → `<corpusRoot>/graph/atlas/` → `<FALSAFA_CORPUS_URL>graph/atlas/`
→ `https://falsafa.ai/corpus/graph/atlas/`. Rejected bundling it (+64 MB on every
first run, a release per Atlas rebuild) and remote-only (denies the flagship layer
to the users who installed properly).

**Big indexes are lazy, not sharded.** `entities-index.json` and `citations.json`
are fetched at most once per session and only by a tool that needs them, so a
session with no Atlas question downloads nothing. Sharding them at build time was
deferred: 1.3 MB gzipped once is acceptable, and a new build artifact is a new
thing that can drift.

**Coverage travels with the data, twice over.** Every `atlas_*` response carries
an `atlas_coverage` block computed from `meta.json` at call time, and the demo's
system prompt is built per question from the same file. Neither path contains a
hardcoded number, so both stay correct as extraction proceeds.

## Architecture

```
Browser (/try)                          Installed MCP (npx @falsafa/mcp)
──────────────                          ────────────────────────────────
providers/tools.ts   13 tool defs       src/index.ts        15 tool defs
providers/systemPrompt.ts               src/atlas.ts        Atlas reader + 5 tools
  buildSystemPrompt(liveCoverage)         disk | HTTP, memoized
localMcp.ts          dispatch           src/tools.ts        catalog tools (FTS5)
  ├─ pagefindSearch.ts  /pagefind/
  └─ atlas.ts           /corpus/graph/atlas/   ← same generated files
```

The invariant that made the browser client work in the first place holds: the
browser and the installed MCP read the **same generated files**, so there is one
source of truth and nothing to hand-sync.

### Search result shape

Rows mirror the installed MCP's FTS5 rows — `work_slug`, `work_title`,
`chapter_number`, `chapter_title`, `chapter_slug`, `variant`, `language`,
`paragraph_id`, `snippet` — plus `citation_url`, which the demo's footnotes need.
Two details do real work:

- **Paragraph resolution.** Take the highest-weighted match location, then the
  `p-` anchor with the greatest location at or before it. A match before the first
  anchor belongs to the first paragraph.
- **chapter_number.** Search hits carry slugs (they come from URLs) while
  `read_chapter` / `get_passage` take numbers, so a hit would be a dead end
  without the hop. Resolved from the flat `mcp-index.json` (272 KB gzipped, once
  per session), not by walking every chapter's `meta.json`.

`scope: "english"` (default) keeps `translation` variants plus English-native
works; `scope: "all"` keeps source-language text. A query over five words that
returns nothing is retried with its three longest (proxy for rarest) tokens and
reports that in `auto_fallback`, matching the installed MCP's behaviour.

Metadata matching stays as the fallback for a missing index (a dev server that
never ran `pagefind --site dist`), and says in its `note` that the results are
catalog matches and **not** passage text.

### The five Atlas tools

| Tool | Answers |
|---|---|
| `atlas_search` | "who/what is X" — name or alias, diacritics folded (`Sakra` → Indra) |
| `atlas_entity` | "where does X appear across the corpus" — per-work gloss + citable quotes |
| `atlas_work` | "what does the Atlas know about this work" + how complete that work is |
| `atlas_citations` | "who quotes / refutes / leans on whom" — stances, counts, quotes |
| `atlas_coverage` | exact live counters, split by language and era |

Payloads are trimmed at the edges (2 quotes per work, 15 works per entity, 10
entities per chapter, 40 chapters per work) so a dossier for a figure in 123 works
stays usable in a context window.

### Honesty properties (the part worth testing)

- A work the Atlas hasn't processed returns `in_atlas: false` **with a note that
  the text is still fully readable** — not an error, and not an empty roster that
  reads as "this work contains nothing".
- An entity below the dossier threshold is distinguishable *before* the call:
  `atlas_search` rows carry `has_dossier`.
- A cited work outside the corpus is flagged `cited_work_in_corpus: false` so the
  model doesn't try to `read_chapter` something we don't hold.
- The coverage caveat states the rule explicitly: absence from the Atlas is not
  absence from the corpus, and `search_corpus` covers all 2,018 works.
- The system prompt's hardcoded "The corpus has 37 works currently" (off by 1,981)
  is gone, replaced by live figures.

## Testing

- `pagefindSearch.test.ts` — anchor→paragraph mapping (match inside, before the
  first anchor), scope filtering, markup stripping, `work_slug` restriction,
  non-chapter pages ignored, `chapter_number` resolution, long-query retry,
  missing index → null, one unreadable fragment doesn't sink the query.
- `atlas.test.ts` (browser) — coverage computed from `meta.json` including the
  caveat text, coverage present on every response, alias and diacritic matching,
  `has_dossier`, quote citation URLs, unprocessed-work path, citation filters,
  indexes fetched once per client.
- `atlas.test.ts` (apps/mcp) — the same behaviours over a temp on-disk Atlas, plus
  source resolution (local dir wins; public URL is the fallback).
- Live verification: all five Atlas tools and Pagefind search exercised in a real
  browser against the dev server, and the Node port against the deployed data.

## Known gaps

- The `/thesis` page describes a "ten-tool surface" tied to the measured eval.
  Left alone deliberately — the eval was run on that surface. Needs an editorial
  decision, not a find-and-replace.
- `themes-index.json` (6.4 MB) is published but unused by any tool. A
  `atlas_themes` tool is the obvious next addition if thematic queries prove common.
- Pagefind ranking differs from FTS5, so the same query can order results
  differently in the demo than in the installed MCP.
