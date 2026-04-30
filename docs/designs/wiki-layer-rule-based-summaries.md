# Design: Wiki layer — rule-based per-chapter and per-work summaries

Generated: 2026-04-30
Branch: main
Repo: adoistic/falsafa
Status: APPROVED — engineering review complete (2026-04-30)
Author: Adnan Abbasi (Thothica) · Brainstormed + reviewed with Claude

## Review decisions (locked 2026-04-30)

These overrides take precedence over any provisional answer earlier in
this document. The schema sections below have been updated inline to
match.

- **D1 (tool surface):** Two new MCP tools — `read_wiki(slug, ch?)` and
  `read_wiki_full(slug, ch?)` — polymorphic on `chapter_number`. Existing
  8 tools untouched.
- **D2 (verbatim fidelity):** Strict — the card MUST contain the FULL
  source paragraph for any quoted block carrying a `[p-XXXXXX]` cite
  handle. No truncation. Card-size budget is soft (~280 typical, may
  flex to ~500 tokens for prose-heavy chapters).
- **D3 (TextRank degeneracy):** Compute TextRank always; emit a
  `textrank_confidence: low | medium | high` field in card frontmatter
  when PageRank-score variance falls below threshold. Card schema is
  uniform; quality is transparent.
- **D4 (drift detection):** `--check` mode + GitHub Actions gate ship in
  v1, NOT v2. PRs touching `corpus/works/**` fail if wiki is stale.
- **D5 (tokenization):** Preserve diacritics (no NFKD normalization);
  treat hyphenated compounds as ONE token (split on whitespace + brackets,
  NOT on hyphen); use Toronto Old English Corpus stopword list for OE.
  All rules deterministic, all source-citable.
- **D6 (snapshot tests):** Snapshot every (work × chapter) combination.
  37 works × ~22 chapters ≈ ~800 snapshot fixtures committed under
  `apps/mcp/test/wiki-snapshots/`.
- **D7 (perf budget):** Hard <5 min full-corpus rebuild target enforced
  by `scripts/bench-wiki.ts` in CI.

Plus one mandatory regression rule from the test review (IRON RULE):

- **R1:** Every `[p-XXXXXX]` emitted by the wiki MUST resolve to a real
  paragraph in the corresponding `paragraphs.json`. Tested against all
  wiki output across all 37 works × all chapters. Critical for the D2
  verbatim-fidelity contract.

## Problem statement

Today, an LLM consuming the Falsafa corpus via MCP has two payload sizes
to choose from:

- **Light** — `list_chapters(work_slug)` returns chapter titles + numbers.
  No semantic shape; the model can't tell what's *in* a chapter without
  reading it.
- **Heavy** — `read_chapter(work_slug, chapter_number)` returns the full
  chapter body (often thousands of words). Expensive to load, and the
  model often needs to read several before finding the right one.

Nothing sits between these. The LLM has to either flail (read multiple
full chapters) or guess (act on a title alone). Both are wasteful.

This proposal adds a *wiki layer* — a deterministic, per-chapter and
per-work summary artifact that the LLM can scan cheaply before deciding
whether to load the full chapter. Karpathy's LLM-Wiki pattern with the
LLM-synthesis step replaced by rule-based extraction. Zero LLM tokens
in any wiki page; every line is either a deterministic statistic or a
verbatim passage with a stable `[p-XXXXXX]` cite handle.

## Goals

1. **Cheap navigation.** Reduce the LLM's first-pass decision cost from
   a chapter read (~1500-3000 tokens) to a card read (~280 tokens).
2. **Verbatim fidelity.** No paraphrase, no synthesis, no "interpreted"
   summary. Every quoted line is the source's actual words with a
   verifiable cite handle.
3. **Reproducibility.** Same corpus → same wiki, byte-identical, every
   time. Rule-based, deterministic, no model dependency.
4. **Auditability.** Each statistical claim ("this is the top trigram",
   "this is the most central paragraph") is computable from public
   primitives. A reviewer can re-run the rules and verify.
5. **Multilingual integrity.** Original-language signature preserved
   alongside English, in Roman-script form.
6. **MCP-additive.** New tools, no breaking changes to the existing 8.

## Non-goals

- No editorial synthesis. The wiki MUST NOT contain LLM-generated prose.
- No translation. The wiki uses what the corpus already has.
- No real-time invalidation. Wiki is a build-time artifact, like
  `corpus/cross-links.json` is today.
- No paragraph-level cross-document cosine. Chapter-level only for v1.
- No live Pagefind integration in v1. The wiki is content; surfacing
  it through site search is a follow-up.

## Architecture overview

```
┌──────────────┐  build-time     ┌────────────────────┐
│ corpus/works │ ───────────────▶│ corpus/works/<slug>│
│   *.md       │                 │   /wiki/*.card.md  │
│   *.json     │  build-wiki.ts  │   /wiki/*.full.md  │
└──────────────┘                 └────────────────────┘
                                          │
                                          ▼
                                  ┌────────────────────┐
                                  │ MCP server         │
                                  │   read_wiki(...)   │  ← cheap card
                                  │   read_wiki_full(.)│  ← heavy sheet
                                  └────────────────────┘
                                          │
                                          ▼
                                       LLM
```

Same conceptual position as `corpus/cross-links.json` today — a
build-time-generated, repo-committed sidecar. Different shape: instead
of a single corpus-wide JSON, the wiki is per-work, per-chapter
markdown.

## Disk layout

```
corpus/works/<slug>/
  manifest.json                     (existing)
  index.md                          (existing — work-level catalog)
  cover.webp                        (existing)
  chapters/<n>-<chapter-slug>/
    translation.md                  (existing — primary source)
    translation.paragraphs.json     (existing — paragraph hashes)
    original.md                     (existing — when present)
    transliteration.md              (existing — when present)
    meta.json                       (existing)
  wiki/                             (NEW — generated artifact)
    _work.card.md                   (per-work card,  ~400 tokens)
    _work.full.md                   (per-work full,  ~3,000 tokens)
    01-<chapter-slug>.card.md       (per-chapter card, ~280 tokens)
    01-<chapter-slug>.full.md       (per-chapter full, ~1,500 tokens)
    02-<chapter-slug>.card.md
    ...
```

Filenames mirror the chapter directories (`01-aa-ke-meri-jaan-...`)
not the chapter numbers alone, to match the existing
`/works/<slug>/<chapter-slug>/` URL convention.

## Per-chapter card schema (`<chapter>.card.md`)

Target: ~280 tokens typical, soft cap. Per D2, verbatim quotes are NEVER
truncated — card-size budget flexes to fit source paragraphs. Per D3,
frontmatter carries a `textrank_confidence` field.

```markdown
---
textrank_confidence: low | medium | high
---

# <Work title> · ch.<n>
<layout> · <paragraph_count>¶ · <word_count>w · vocab <distinct_types> (TTR <ttr>, hapax <pct>%)

## Distinctive trigrams
"<t1>" · "<t2>" · "<t3>"

## Key passage (TextRank #1)
> [p-<hash>] <FULL verbatim paragraph — no truncation>

## Opens
> [p-<hash>] <FULL verbatim first paragraph — no truncation>

## Closes
> [p-<hash>] <FULL verbatim last paragraph — no truncation>

## Refrain (top, when present)
"<phrase>" — <count>× (first at p-<hash>)

## Nearest in corpus
<work-shortname> ch.<n> 0.<cosine> · <work-shortname> ch.<n> 0.<cosine> · ...

## Original-language signature (<language>, top-3)         (when Roman-script source available)
"<t1>" · "<t2>" · "<t3>"
```

**`textrank_confidence` rule:** computed from PageRank-score variance.
When variance < 0.1 (uniform-ish PageRank → arbitrary "central" pick),
flag as `low`. Empirically this means short chapters (typically
`paragraph_count < 10`, common in Iqbal/Ghalib/Zauq verse).

**Required sections:** header, fingerprint line, distinctive trigrams,
key passage, opens, closes, nearest in corpus.

**Conditional sections:** refrain (if any verbatim phrase ≥2× in the
chapter), original-language signature (if a Roman-script source
exists per the multilingual policy).

## Per-chapter full schema (`<chapter>.full.md`)

Target: ~1,500 tokens, ~80 lines.

Card content + the following expansions:

```markdown
## Top-20 unigrams (TF-IDF against corpus background)
<term> <score> · <term> <score> · ... (20 entries)

## Top-20 bigrams (n-gram TF-IDF)
"<bigram>" <score> · ... (20 entries)

## Top-20 trigrams (n-gram TF-IDF)
"<trigram>" <score> · ... (20 entries)

## Strongest collocations (NPMI top-10)
<word_a> + <word_b> NPMI <0.xx>
... (10 entries)

## Key passages (TextRank top-3, verbatim)
> [p-<hash>] <text>
> [p-<hash>] <text>
> [p-<hash>] <text>

## Cross-check (LexRank top-3, verbatim)
> [p-<hash>] <text>
> [p-<hash>] <text>
> [p-<hash>] <text>

## All refrains (≥2× verbatim)
"<phrase>" — <count>× — paragraphs: p-<hash>, p-<hash>, ...
... (one entry per refrain)

## Topic boundary signals
Vocabulary-shift valleys at paragraphs: ¶<n>, ¶<n>, ... (boundary candidates)

## Stylometric outlier check
Burrows' Delta vs. work-average opening: <delta_score>
Burrows' Delta vs. work-average closing: <delta_score>
(Flag: chapter <opens|closes> stylistically unlike the rest of the work, when delta > 1.5σ)

## Phrases unique to this chapter (vs. rest of work, top-8)
"<phrase>" · "<phrase>" · ...
```

## Per-work card schema (`_work.card.md`)

Target: ~400 tokens, ~30 lines.

```markdown
# <Work title>
<author> · <era> · <language> · <layout> · <chapter_count> chapters · <total_words> words

## Work-level distinctive trigrams (top-12 across all chapters)
"<t1>" · ... · "<t12>"

## Work-level NPMI signature collocations (top-6)
<a> + <b> · <a> + <b> · ... (6 entries)

## Chapter map
ch.1  — <TextRank #1 from ch.1, truncated at 80 chars on punctuation>
ch.2  — <TextRank #1 from ch.2, ...>
...

## Statistically nearest works in corpus
<work-shortname>  cosine 0.<xx>
<work-shortname>  cosine 0.<xx>
... (top-4)

## Phrases unique to this work (vs. rest of corpus, top-8)
"<phrase>" · ... · "<phrase>"

## Original-language signature (top-6)               (when Roman-script source available)
"<t1>" · ... · "<t6>"
```

**The chapter map is the marquee item.** Each chapter's TextRank #1
paragraph, deterministically truncated to ~80 chars at the first
sentence boundary or comma. Lets the LLM see the work's *shape* in
one glance without loading any chapter card.

## Per-work full schema (`_work.full.md`)

Target: ~3,000 tokens.

Card content + every chapter's card (truncated, no full-paragraph quotes
inlined) + full TF-IDF tables (work-level top-50 unigrams / 50 bigrams /
50 trigrams) + cross-corpus Burrows' Delta against every other work.

**Open question for engineering review:** is the per-work full sheet
worth building? See "Open questions" below.

## Statistical algorithms

All algorithms are classical, well-studied, deterministic.

### Tokenization

- Lowercase the text. Split on Unicode whitespace + punctuation
  (`[\s\p{P}]+`). Discard tokens of length 1 or 2 unless they're known
  meaningful (e.g. "om", "ka").
- Per-language stopword lists for English / French / German / Old
  English. Sanskrit / Old Javanese / Urdu transliterations: no stopword
  list (rare-word distribution is the signal).

### TF-IDF

- Document = chapter (English-translation body, post-tokenization).
- Term frequency: raw count / chapter length.
- Inverse document frequency: `log((N + 1) / (df + 1)) + 1` where
  N = total chapters in corpus (818), df = chapters containing the term.
- Score = TF × IDF.
- Top-K via stable sort (score desc, term asc as tiebreak).

### N-grams

- Generate bigrams and trigrams over the same tokenization, before
  stopword removal (so collocations like "the great-souled" survive).
- TF-IDF identically applied at the n-gram level.

### NPMI (Normalized Pointwise Mutual Information)

- For each ordered bigram (a, b) in the chapter:
  - `PMI(a,b) = log( P(a,b) / (P(a) × P(b)) )`
  - `NPMI(a,b) = PMI(a,b) / -log(P(a,b))`
  - Range: [-1, 1]. Higher = stronger collocation.
- Filter: minimum joint count ≥3 to avoid sample noise.
- Top-K via NPMI desc.

### TextRank-on-paragraphs (extractive summarizer)

- Build similarity matrix between paragraphs in the chapter.
  - Similarity = TF-IDF cosine, computed at *paragraph* level
    (treating each paragraph as a tiny document).
  - Threshold: edges below 0.1 dropped (Mihalcea & Tarau).
- Run PageRank with damping = 0.85, max 50 iterations or convergence
  (Δ < 1e-6).
- Top-K paragraphs by PageRank score.

### LexRank (cross-check)

- Same as TextRank but with cosine threshold = 0.2 (denser graph) and
  unweighted edges. Used as a sanity check in the full sheet — if
  TextRank and LexRank disagree on top-3, it's worth flagging.

### Refrain detection

- For each pair of paragraphs (i, j) where j > i:
  - Compute normalized edit distance (Levenshtein / max-length).
  - If distance ≤ 0.05 (tokens, not characters), classify as a refrain.
- Group transitively: if (i,j) and (j,k) are matches, all three form
  one refrain group.
- Report: phrase = the longest common subsequence of tokens; count =
  group size; first cite = paragraph hash of the earliest member.

### Vocabulary richness

- Type-token ratio (TTR) = `distinct_types / total_tokens`.
- Hapax ratio = `tokens_appearing_exactly_once / distinct_types`.

### Cross-document cosine ("nearest in corpus")

- Reuses the existing TF-IDF vectors built for `find_related`.
- For each chapter, compute cosine to every other chapter, sort desc,
  take top-K (K=3 in card, K=5 in full).
- "Self" (other chapters of the same work) is preferred at the top
  to surface intra-work resonance; "cross-work" hits are listed too.

### Burrows' Delta (stylometric outlier check, full sheet only)

- Compute per-chapter token frequency for the top-100 most frequent
  tokens in the corpus.
- For each chapter, z-normalize against the work-mean and
  work-stdev for those 100 tokens.
- Burrows' Delta = mean of absolute z-scores.
- Flag chapters with Delta > 1.5σ from work-mean as "stylistically
  outlying."

## Multilingual policy

The card includes a 3-line "Original-language signature" section when
a Roman-script source is available for the work:

```
src = (language is Roman-script-native AND has original.md) ? "original.md"
    : (transliteration.md exists)                            ? "transliteration.md"
    : null  // omit the section entirely
```

Roman-script-native languages in the current corpus: Old English,
French, German.

Non-Roman with transliteration available: Sanskrit (all smṛtis), Urdu
(Iqbal / Ghalib / Zauq), Old Javanese / Kawi (all tattva texts).

Post Nyāya Tilakam removal, all 37 works in the corpus have a usable
Roman-script source. The "skip" branch is currently dead but retained
for future ingestions.

## MCP tool surface

Two new tools, additive only:

### `read_wiki`

```typescript
{
  name: "read_wiki",
  description:
    "Read the wiki card for a work or a specific chapter. Cheap " +
    "navigation entry-point; ~280-400 tokens. Use this BEFORE " +
    "read_chapter to decide which chapters are worth a deep read. " +
    "Each card is rule-based (TF-IDF, TextRank, n-gram extraction) " +
    "and contains verbatim openings, closings, and TextRank-key " +
    "passages with [p-XXXXXX] cite handles.",
  parameters: {
    work_slug: { type: "string", required: true },
    chapter_number: { type: "integer",
      description: "Optional. If present, returns the chapter card. If absent, returns the work card." },
  },
}
```

### `read_wiki_full`

```typescript
{
  name: "read_wiki_full",
  description:
    "Read the full wiki sheet — same as read_wiki but with " +
    "n-gram tables, NPMI collocations, all refrains, every TextRank " +
    "and LexRank top-3, boundary signals, and stylometric flags. " +
    "~1,500-3,000 tokens. Opt-in for deep statistical analysis; " +
    "most queries should use read_wiki first.",
  parameters: {
    work_slug: { type: "string", required: true },
    chapter_number: { type: "integer", optional: true },
  },
}
```

The model's escalation path:
```
list_works → read_wiki(work) → read_wiki(work, ch) →
  read_chapter(work, ch) → quote [p-XXXXXX]
```

Each step is a token-cheap escalation. A model that can answer from
the chapter card alone (e.g. "what's in this chapter?") never needs
to load the full chapter.

## Build pipeline

`scripts/build-wiki.ts` (new), invoked manually:

```bash
bun run scripts/build-wiki.ts                # full corpus rebuild
bun run scripts/build-wiki.ts --work <slug>  # rebuild one work only
bun run scripts/build-wiki.ts --check        # dry-run, fail if outputs would differ from on-disk
```

### Pipeline stages

1. **Load corpus.** Iterate `corpus/manifest.json` works. For each work
   read all chapter `translation.md` (and Roman-script source per
   multilingual policy) + `*.paragraphs.json`.
2. **Build per-chapter primitives.**
   - Tokenize + tf for each chapter
   - Run pairwise paragraph similarity → TextRank / LexRank
   - Detect refrains
   - Compute n-grams + NPMI
3. **Build corpus-wide primitives.**
   - df / IDF aggregated across all chapters
   - TF-IDF top-K per chapter
   - Cross-document cosine (reuse existing index from `cross-links.json`
     where possible — extend to include n-grams)
4. **Render markdown.** Per-chapter card + full, per-work card + full.
5. **Write to `corpus/works/<slug>/wiki/`.** Atomic per-file
   (write `.tmp` then rename) so an interrupted build leaves no
   partial artifacts.

### Performance target (HARD per D7)

- Full corpus rebuild: <5 min on a 2024 MacBook. Enforced by
  `scripts/bench-wiki.ts` running in CI on every PR. Build fails if
  the budget is exceeded.
- Per-work rebuild: <30 sec.

### Determinism guarantees

- All pseudo-random elements seeded explicitly (none currently).
- All sort orders stable (score desc, then lexical asc as tiebreak).
- Output: byte-identical for byte-identical input. `git diff`
  on `corpus/works/*/wiki/` should be either empty or fully
  meaningful (no flapping).

## Trigger / staleness model (UPDATED per D4)

- Wiki is generated and committed to the repo.
- Author runs `bun run scripts/build-wiki.ts` after corpus changes.
- **`--check` mode + GitHub Actions gate ship in v1.** PRs touching
  `corpus/works/**` run `bun run scripts/build-wiki.ts --check`; the
  PR fails if the wiki on disk doesn't match what `build-wiki` would
  produce from the live corpus. Closes the drift hole permanently.
- Pre-commit hook still deferred to v2 — adds friction for marginal
  benefit once CI catches drift.

## Open questions for engineering review

These are explicit hand-offs to engineering review. Each has a
provisional answer; engineering can override with feasibility data.

### Q1. Is the per-work full sheet worth building?

A model that wants deep statistical analysis can re-read the per-work
card + drill into chapter cards / chapter fulls. The per-work full
might be redundant.

**Provisional answer:** build it (cheap, byte-stable). Mark for
deletion in v2 if real usage shows nobody escalates to it.

### Q2. Cross-document cosine: chapter-level only, or also paragraph-level?

Today `find_related` is chapter-level. Paragraph-level would surface
"this paragraph is statistically nearest to Yājñavalkya 3.84 §17" —
powerful, but requires a much larger pairwise comparison matrix
(~76,210 paragraphs × 76,210 = 5.8B pairs).

**Provisional answer:** chapter-level for v1 (~818 × 818 = 670K
pairs, well within budget). Paragraph-level deferred. If we want
*signature* paragraph-level cross-references (rare gems), a different
algorithm — e.g. content-hash collision detection on bigram shingles
— is faster than a full cosine matrix. Engineering review should
weigh this.

### Q3. Refrain detection: token-level edit distance vs. shingle hashing?

Token-level edit distance is O(n²) per chapter pair — fine within a
chapter (avg 50-200 paragraphs) but not globally. For across-corpus
refrain detection (e.g. formulas shared between Manu and Yājñavalkya),
we'd want bigram-shingle Jaccard or MinHash.

**Provisional answer:** within-chapter only for v1 (the use case is
"this chapter has a refrain"). Cross-corpus formula detection is a
distinct paper-grade contribution — defer to v2.

### Q4. Tokenization: language-aware stopword lists?

The corpus is multilingual. English / French / German have well-known
stopword lists. Sanskrit / Old English / Old Javanese / Urdu
(transliterated) do not have canonical stopword lists.

**Provisional answer:** stopword removal for English / French / German
/ Latin. No stopword removal for transliterated languages — let
TF-IDF handle stopword-like terms (they'll have high df → low score).
Engineering should validate this against a few sample chapters per
language.

### Q5. Cover the existing `cross-links.json` build?

Today's `cross-links.json` is a separate sidecar. The wiki layer
recomputes some of the same primitives (TF-IDF cosine). One option:
fold cross-links generation into `build-wiki.ts` for atomicity.
Other option: keep them separate, share an underlying TF-IDF index
module.

**Provisional answer:** keep separate for v1. Both scripts import a
shared `corpus-tfidf-index.ts` module. Avoids a "rebuild everything"
forcing function for one-side changes.

### Q6. Per-language n-gram size limits?

Old English has compound words. Sanskrit transliteration has hyphenated
compounds ("hiraṇya-garbha"). Urdu has space-separated multi-word
expressions ("dil-e-naadan"). Capping at trigrams for all languages
might be too tight for compound-heavy languages.

**Provisional answer:** trigrams for v1 across all languages. Revisit
if specific languages produce shallow signals.

### Q7. Storage cost?

Estimate: ~5KB per chapter card + ~30KB per chapter full + ~5KB per
work card + ~25KB per work full. With 37 works × ~22 chapters/avg ×
2 files per chapter + 2 work-level files per work:
- chapter cards: ~37 × 22 × 5KB = ~4MB
- chapter fulls: ~37 × 22 × 30KB = ~24MB
- work cards: ~37 × 5KB = ~200KB
- work fulls: ~37 × 25KB = ~1MB
- **total: ~30MB** committed to repo.

Acceptable for a one-time addition. Will scale to ~1.2GB when Perseus
ingestion ships at 1,500 works — at that point the wiki should
probably move out of the repo (CDN, separately versioned tarball).

**Provisional answer:** in-repo for v1. Plan migration path for v2.

## Risks

1. **Drift between wiki and corpus.** If author edits a chapter and
   forgets to re-run `build-wiki.ts`, the wiki points at stale cite
   handles. Mitigation: v2 CI-staleness check.
2. **Bad TextRank picks for short chapters.** Chapters with <10
   paragraphs may produce "key passages" that are arbitrary (everything
   is similar to everything). Mitigation: `--check` mode flags
   chapters where TextRank score variance is < threshold.
3. **N-gram noise on transliterated languages.** "om namo bhagavate"
   may surface as a top trigram across many Sanskrit chapters — true
   but uninformative. Mitigation: tune the IDF cutoff and/or add a
   per-language minimum-distinctiveness threshold.
4. **Paragraph hash mismatches if `paragraphs.json` regenerates.**
   The wiki's `[p-XXXXXX]` quotes assume hash stability.
   Mitigation: pin the wiki's regenerator to read `paragraphs.json`
   atomically with the markdown, so a hash-changing edit always
   re-renders the wiki entry simultaneously.
5. **CC BY-SA contagion when Perseus lands.** The wiki includes
   verbatim quotes from the source. If the source is CC BY-SA, the
   wiki is too. Mitigation: license-detection per work, encode in
   wiki frontmatter, refuse to mix license tiers in any aggregate.

## Testing strategy

Updated per engineering review D6 + R1.

1. **Unit tests** per algorithm (TF-IDF, TextRank, NPMI, refrain
   detection) against fixture corpora with known correct outputs.
2. **Snapshot tests** of `corpus/works/<slug>/wiki/*` against committed
   expected output for **every (work × chapter) combination** (D6).
   ~800 snapshot fixtures stored under
   `apps/mcp/test/wiki-snapshots/`. Catches layout / language /
   tokenization regressions everywhere, not just in 2-3 representative
   works.
3. **Determinism test:** run `build-wiki.ts` twice in succession, diff
   output trees, expect zero diff.
4. **Smoke test for MCP tools:** `read_wiki(slug)` returns a card,
   `read_wiki(slug, n)` returns a chapter card, `read_wiki_full`
   returns the full sheet, errors on unknown slug, errors gracefully on
   slug with missing `wiki/` dir.
5. **`--check` mode test:** intentionally edit a chapter without
   rebuilding, expect `--check` to fail.
6. **R1 — paragraph-hash existence test (CRITICAL, IRON RULE):**
   Every `[p-<hash>]` emitted by the wiki MUST resolve to a real
   paragraph in the corresponding `paragraphs.json`. Tested
   automatically against all wiki output across all 37 works × all
   chapters. A wiki page citing a non-existent paragraph hash is a
   thesis violation, not just a bug — this test gates merge.
7. **Tokenization property fuzz** (per D5): randomized inputs covering
   combining diacritics, RTL marks, smart quotes, hyphenated compounds,
   transliterated edge cases. Tokenizer output must be deterministic
   across the property space.
8. **E2E happy-path test for MCP navigation:** simulated agent flow
   `list_works → read_wiki(slug) → read_wiki(slug, ch) → read_chapter
   → quote [p-<hash>]`. Asserts every step produces parseable markdown
   that the next step can consume.
9. **Performance bench (per D7):** `scripts/bench-wiki.ts` measures
   full-corpus rebuild time. Asserts <5 min. Runs in CI on every PR.
   Protects against silent perf regressions.

## Migration / rollout

- v1 (this design): manual build trigger. Wiki committed to repo.
  Two new MCP tools. Existing 8 untouched.
- v1.1: site UI surfaces the cards on `/works/<slug>/<chapter>/`
  pages (collapsible card-preview above the chapter body). Pure UX,
  no schema change.
- v2: pre-commit hook + CI staleness check. Cross-corpus refrain
  detection. Paragraph-level "nearest passages."
- v3 (Perseus-scale): wiki moves out of repo to CDN. Lazy-load via
  HTTP fetch in MCP tool.

## Future work / paper hooks

- The wiki layer is the operational version of the "Karpathy wiki at
  archive scale" thesis claim in the paper-positioning doc. Every
  guarantee in this design (zero LLM tokens, byte-stable output,
  verbatim cite handles) is a paper-grade primitive.
- The "chapter map" feature in `_work.card.md` (per-chapter TextRank
  #1 truncated) is a contribution worth a section on its own — it's
  a deterministic table-of-contents that's directly actionable by an
  LLM.

## Status checklist

- [x] Brainstorm complete
- [x] Design doc written (this file)
- [x] Engineering review (2026-04-30)
- [ ] Implementation plan (writing-plans skill)
- [ ] Implementation
- [ ] v1 ship: `corpus/works/*/wiki/` populated, two MCP tools live, all tests pass
- [ ] v1.1: site card-preview UI

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 7 issues raised, all resolved; 1 critical regression rule (R1) added unconditionally |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Not required — scope locked in brainstorm with one user |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Skipped per user (D8) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Not applicable — wiki is a data layer; UI integration deferred to v1.1 |

**Decisions locked in this review:**
- D1: two new MCP tools (polymorphic, as proposed)
- D2: strict verbatim — no truncation in cite-handle blockquotes
- D3: TextRank quality flag in card frontmatter (`textrank_confidence`)
- D4: `--check` mode + CI staleness gate ship in v1
- D5: tokenization preserves diacritics + compounds; Toronto OE Corpus stopwords
- D6: snapshot every (work × chapter), ~800 fixtures committed
- D7: hard <5 min perf budget, CI bench script enforces

**Mandatory regression rule:** R1 — every emitted `[p-<hash>]` resolves to a real paragraph (paragraph-hash existence). Tested across all wiki output. Critical for the verbatim-fidelity contract.

**Cross-doc bookkeeping:**
- TODOS.md `Embeddings-based cross-link upgrade` marked SUPERSEDED by this design
- TODOS.md gained two v2 items: cross-corpus refrain detection (MinHash) + site UI cards on chapter pages

**UNRESOLVED:** 0 — all raised issues resolved.

**VERDICT:** ENG CLEARED — ready for `/writing-plans` to produce the implementation plan.
