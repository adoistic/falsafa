# Falsafa

A free, open library of **2,018 classical works across nine languages and
twenty-five centuries, carried into English** — paired with an **atlas**: a
citation-grounded ontology extracted from the source texts themselves, where
every claim is anchored to a verbatim, quotable paragraph. Plus an open-source
MCP server that hands any LLM the same corpus. Built by
[Adnan](https://meetadnan.com). Free, public, MIT. Live at
[falsafa.ai](https://falsafa.ai).

Why it exists, in one line: every classical text that survives was carried, by
translators, revisers and patrons with names, and Falsafa continues that
practice for the newest readers — human and machine. The reading library is
the welcome mat; the durable asset is the ontology.

**Two things sit on the same corpus:**

- **The library** — [`/works`](https://falsafa.ai/works/) — 2,018 works in
  their original scripts (polytonic Greek, Devanagari, IAST, Nastaliq, Kawi…)
  with English translations, every paragraph a stable, citable anchor
  (`p-xxxxxx`).
- **The atlas** — [`/atlas`](https://falsafa.ai/atlas/) — the ontology of the
  library, drawn from the texts by machine readers under one discipline: **no
  claim without a verbatim quotation.** ~37,000 entities (figures, ideas,
  places, peoples, events, objects, animals), ~13,000 stance-typed citations,
  and 363,000 verbatim anchors — one **concept page** per idea, showing every
  way the corpus speaks of it (*Time — spoken of as kāla in the Sanskrit
  texts*). It grows on its own as the harvest reads deeper.

The book-length argument behind it is at [`/book`](https://falsafa.ai/book/)
(*Carried Across: how ideas travel*); the engineering is in the
[engine room](https://falsafa.ai/engine/).

The fastest way in:

```bash
npx -y @falsafa/mcp
```

That's the librarian. Ten tools (list, read, search, cite, compare, plus
the rule-based wiki layer — `read_wiki` and `read_wiki_full`),
zero API keys, zero state, zero inference cost on our side. Karpathy-flavored:
the MCP is a librarian, not a second LLM. Your model does the reasoning.

> First run downloads the corpus snapshot (~185 MB compressed, ~800 MB on disk) from a GitHub release into your cache, verifies its checksum, and builds a local search index; the npm package itself is ~100 KB. If your
> MCP client times out before the download completes, run
> `npx -y @falsafa/mcp` once in a terminal first to warm npm's cache.

## Install in your daily LLM (30 seconds)

### Claude Code

```bash
claude mcp add falsafa npx -y @falsafa/mcp
```

That's it. Any `claude` session now has the Falsafa tools available.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] }
  }
}
```

Restart Claude Desktop. The Falsafa tools show up in the tool palette. Ask
"what works does Cynewulf have?" and the model calls `list_works({ author: "cynewulf" })`.

### Cursor

Settings → **MCP** → *Add new global MCP server*, paste the same `mcpServers`
JSON above. Or edit `~/.cursor/mcp.json` directly.

### Codex CLI

```bash
codex mcp add falsafa -- npx -y @falsafa/mcp
```

Persists in `~/.codex/config.toml`. The `--` separator is required.

See `apps/mcp/README.md` for the full tool reference and example interactions.

## What's in the corpus

Numbers from `corpus/manifest.json` (regenerated on every convert):

| | Count |
|---|---|
| Works | 2,018 |
| Authors | 622 |
| Logical chapters | 25,499 |
| Variant entries (translation, transliteration, original) | 34,512 |
| Addressable passages (stable `p-xxxxxx` anchors) | 1,375,137 |
| Languages | Greek, Latin, Sanskrit, English, French, Urdu, Kawi (Old Javanese), Old English, German |
| Eras | Ancient → 20th Century (twelve), ~1500 BCE – 1952 CE |

From the Ṛgveda and the full Rāmāyaṇa to Homer, Plato, Euclid, Cicero, the
Roman-law corpus, Cynewulf's Old English poems, Iqbal's Bang-E-Dara, Ghalib
and Zauq, and the 19th-century political economists. Sourced from Perseus,
GRETIL, and other public archives (see below). Each work ships with the
original-language source, a Latin-script transliteration where it makes sense,
and Thothica's English translation. Every paragraph has a stable
content-derived ID (`p-xxxxxx`) so citations survive reformatting. The
corpus grows; the site and atlas pick up new works automatically on the next
build.

**Translations are AI-assisted.** AI can make mistakes — when accuracy
matters, verify against the original-language source linked on each
chapter page. The translations are produced by Thothica's pipeline
across frontier LLMs (Claude / GPT / Gemini); the original-language
texts come from public archives.

### Sources

The source texts come from freely available digital archives plus
transcribed printed editions:

- **Greek & Latin classics** (Homer, Plato, Aristotle, Euclid, Cicero, the Roman-law corpus, and hundreds more) — [Perseus Digital Library](http://www.perseus.tufts.edu/)
- **Sanskrit** (Ṛgveda, the Rāmāyaṇa, the dharmaśāstra smṛti cluster, the Kawi / Old-Javanese tattvas) — [GRETIL](http://gretil.sub.uni-goettingen.de/gretil.html), Göttingen Register of Electronic Texts in Indian Languages
- **Old English** (Cynewulf's Juliana / Elene / Andreas; OE Elegies) — [sacred-texts.com](https://sacred-texts.com/)
- **Allama Iqbal** (Bāng-i-Darā parts 1-3) — [allamaiqbal.com](http://allamaiqbal.com), Iqbal Academy Pakistan
- **Mirza Ghalib + Sheikh Ibrahim Zauq** (Urdu diwans) — printed editions

Same list with full citations on the deployed site at `/about/#sources`. The
acquisition order (Perseus → GRETIL/Indic → Liberty Fund → Islamic → …) is
tracked in `docs/`.

## The atlas — the ontology of the library

The atlas at [`/atlas`](https://falsafa.ai/atlas/) is a map of the corpus
drawn from the texts themselves: who cites whom and with what stance; where
the figures, ideas, places, peoples, events, objects and animals of
twenty-five centuries appear. Its discipline is carried over from library
practice — **no claim without a verbatim quotation.** A machine reader may
only point at paragraphs; the quotation is attached afterwards,
deterministically, from the source text, so a fabricated quote is structurally
impossible. Every entry links to the exact paragraph that carries it, and each
marked term in the reader opens its atlas entry inline.

Two things make it more than a tag cloud:

- **One concept, every expression.** A *concordance* pass unifies the ways the
  corpus names the same thing — *Time* shows the Sanskrit *kāla*; *Truth*
  gathers Greek *alḗtheia* and Sanskrit *satya* — each as a legible "spoken of
  as" facet with its own language, works and quotes. A curated guard list
  keeps genuinely-distinct concepts apart (*dharma* ≠ law, *ātman* ≠ soul, the
  Gods ≠ God), and cross-references (*Kāla, see Time*) run through the ledger
  like a real index.
- **It updates itself.** The harvest runs independently and writes to
  Cloudflare R2; every build syncs the latest, re-runs synthesis, and redraws
  every page. Nothing is hardwired — new works and new coverage flow in on
  the next `bun run deploy`. Pipeline: `scripts/atlas/` (`sync-harvest.ts`,
  `synthesize.ts`, `concordance.json`); data model and rationale in
  `docs/atlas-rebuild/`.

## Try it without installing anything

The browser-bundled MCP runs end-to-end at `falsafa.ai/try` (ships at
launch). Bring your own OpenAI, Anthropic, OpenRouter, or Gemini key, paste
it, ask anything. The same tool calls fire client-side, against the same
corpus, with paragraph-anchored citations that link back to the reader.
Key never leaves the browser. Source under `apps/site/src/islands/byok/`.
Pre-launch: `cd apps/site && bun run dev`, then visit `/try`.

## Repo layout

```
falsafa/
├── corpus/             # markdown source of truth, manifest, paragraph index
│   └── graph/          # ontology harvest (ontology-runs/) + derived atlas/
├── apps/
│   ├── site/           # Astro 5 reading site, atlas, /try BYOK demo
│   ├── worker/         # Cloudflare Worker that serves the built site from R2
│   ├── mcp/            # @falsafa/mcp, stdio MCP server (Bun + TS)
│   ├── pipeline/       # `npx @falsafa/pipeline ingest` (in progress)
│   └── baseline/       # hybrid RAG baseline for the eval comparison
├── eval/               # 1,120-question audited pool (Agents A/B/C)
├── scripts/
│   ├── atlas/          # atlas sync + synthesis + concordance
│   ├── og/             # per-work Open Graph image generator
│   ├── graph/          # ontology extraction (anchor-range-v1)
│   └── …               # convert, audit, cross-link, image-gen, per-source ingest
├── docs/atlas-rebuild/ # atlas data model, design direction, build log
└── TODOS.md            # deferred items + remote MCP gate
```

## Eval

The eval split is honest about what the model is being tested on. Two
tiers, scored separately:

- **Citation tier** (`tier: "named"`, 757 questions). The prompt names the
  work — "what does Ghalib's ghazal X say about Y?" — and the model has
  to find the right passage. Tests citation precision once the work is
  located.
- **Discovery tier** (`tier: "hidden"`, 363 questions: 126 hand-built +
  237 reclassified from the 1k pool). The prompt describes the *content*
  without naming the work — "which work argues X via Y metaphor?" — and
  the model has to find the right work by content alone, then cite the
  right passage in it. Discovery is the real test; citation is the
  sub-claim.

The pool is at `eval/questions-revised-1000.json` (named) and
`eval/questions-discovery-v1.jsonl` (hidden). Total 1,120 questions
across 7 categories (citation, comparative, specific-obscure, thematic,
conceptual, multilingual, cross-cultural).

**Scoring is deterministic.** A case passes when every
`expected_works` entry appears in the model's answer, with NFKD
diacritic folding so "Manusmṛti" matches "manusmrti." No LLM judge
runs at score time — the verdict is a substring check on prose with
explicit pass/fail. A graded 3-state score (pass / mixed / fail)
tied to citation discipline is queued (see `TODOS.md` ⚠ section);
the published numbers today are the loose-pass version, the paper
will use the graded version. See
[`/thesis/#methodology`](https://falsafa.ai/thesis/#methodology)
for the trade-off and what the current numbers measure.

Per-question cost + token tracking pulled directly from OpenRouter's
authoritative `usage.cost` field — no hardcoded prices, no estimates.
Each result records prompt / completion / cached tokens, API call
count, and per-step breakdown showing which tools cost which tokens.
Aggregated per model into eval.json: total spend, total tokens,
average per question. Visible at `falsafa.ai/eval` with per-case step
traces.

The eval runner is `apps/mcp/eval/run-openrouter.ts` — give it
`--model x-ai/grok-4.1-fast` and an OPENROUTER_API_KEY and it does
the rest. Atomic per-question writes, SIGINT-safe, supports
`--concurrency`, `--random`, `--seed`, both JSON + JSONL pools.

### Wiki-layer A/B — first results

The corpus has a rule-based wiki layer per
[`docs/designs/wiki-layer-rule-based-summaries.md`](docs/designs/wiki-layer-rule-based-summaries.md):
deterministic per-chapter and per-work cards generated by classical
statistical algorithms (TF-IDF n-grams, NPMI, TextRank, refrain
detection), zero LLM tokens in any output, every quote with a stable
`[p-XXXXXX]` cite handle. Two MCP tools (`read_wiki`,
`read_wiki_full`) surface it. Build script:
`bun run scripts/build-wiki.ts` (manual rebuild, with `--check` mode
for the CI staleness gate).

The experimental contribution: **same model, same questions, same
prompts modulo the available-tools list. Only variable: whether the
LLM has the wiki layer to scan before drilling into chapters.**
Baseline (no wiki, 8 tools) vs treatment (with wiki, 10 tools) on
the same 1,120-question pool, Grok 4.1 Fast both arms.

| Metric | Baseline (no wiki) | Wiki | Δ |
|---|---:|---:|---:|
| Overall pass rate | 84.6% (948/1,120) | **85.4% (956/1,120)** | +0.8pp / +8 cases |
| Citation tier (named) | 96.2% (728/757) | **96.6% (731/757)** | +0.4pp |
| Discovery tier (hidden) | 60.6% (220/363) | **62.0% (225/363)** | +1.4pp |
| Total spend | $13.36 | **$12.43** | **−$0.93 (−7%)** |
| Total tokens | 71.3M | 72.2M | +1.3% |

Modest pass-rate lift (+8 cases, mostly on the discovery tier where
cheap navigation cards keep the model from blind-reading whole
chapters), at lower cost. Live audit at `falsafa.ai/eval` —
side-by-side per-case in the redesigned A/B explorer. Caveat: the
current scoring is the diacritic-folded substring metric; the
graded 3-state rework (per `TODOS.md`) will tighten these numbers
before the paper.

## Status

Live at [falsafa.ai](https://falsafa.ai). The library, the atlas, the reader
integration, and the engine room are all deployed.

| Surface | State |
|---|---|
| [`/works`](https://falsafa.ai/works/) library (2,018 works, 9 scripts) | ✅ live |
| [`/atlas`](https://falsafa.ai/atlas/) ontology atlas (entities, citations, concept pages) | ✅ live |
| [`/book`](https://falsafa.ai/book/) *Carried Across* | ✅ live |
| [`/engine`](https://falsafa.ai/engine/) engine room hub | ✅ live |
| [`/try`](https://falsafa.ai/try/) BYOK live demo | ✅ live |
| [`/eval`](https://falsafa.ai/eval/) eval explorer (A/B baseline vs wiki) | ✅ live |
| [`/thesis`](https://falsafa.ai/thesis/) why no vector DB (+ `#methodology`) | ✅ live |
| [`/numbers`](https://falsafa.ai/numbers/) by-the-numbers | ✅ live |
| `npx @falsafa/mcp` published to npm | ✅ [live on npm](https://www.npmjs.com/package/@falsafa/mcp) |
| Per-work Open Graph share cards (all 2,018) | ✅ generated + wired |
| arXiv preprint | pending — gated on graded-score eval rework (`TODOS.md`) |
| PR back to PerseusDL | pending |

**Deploy:** the site is a fully static Astro build (~44k pages), built locally
and mirrored to **Cloudflare R2**; the `falsafaai` Cloudflare **Worker**
serves it at `falsafa.ai`. Not Netlify/Vercel — at this scale (~143k files)
hosted builders OOM and file-count caps bite. One command, `bun run deploy`
(`scripts/deploy.sh` = build + `rclone sync` to R2); full architecture in
[`DEPLOY.md`](DEPLOY.md). The ontology harvest runs independently and writes
to R2; each build syncs it, re-synthesizes the atlas, and regenerates share
cards — so new works and new coverage appear automatically. Remote MCP
backend (claude.ai Connector + ChatGPT GPT) is tracked in `TODOS.md`.

## Run it locally

```bash
bun install

# audit + convert (no API key needed)
bun run audit
bun run convert

# refresh the atlas from the harvest (sync latest from R2, re-synthesize)
bun run atlas:sync && bun run atlas:build

# reading site + atlas + /try BYOK demo
cd apps/site && bun run dev

# MCP server, stdio
cd apps/mcp && bun run dev

# MCP eval suite (deterministic citation-based scoring against expected_works)
cd apps/mcp && bun run eval

# ship it (build locally → rclone sync to Cloudflare R2)
bun run deploy
```

`bun run build` in `apps/site` runs the atlas sync + synthesis + Open Graph
generation automatically before the Astro build, so a production build is
always current with the harvest.

Cover imagery is a separate five-stage agentic pipeline: draft, cross-vendor
critique, decide, render, audit. See `scripts/generate-images.ts` and
`style-guide.json` for the per-series anchors. Roughly $0.11 and 4 minutes
per cover.

## License

MIT. Translations and transliterations produced by
[Thothica](https://thothica.com) and released as a public good with the
rest of the corpus.

## Acknowledgments

Karpathy's [vector-DB-less RAG gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
is the philosophical anchor for the MCP.
[Emergent Ventures India](https://www.mercatus.org/emergent-ventures)
([15th cohort](https://marginalrevolution.com/marginalrevolution/2025/12/emergent-ventures-india-15th-cohort.html))
funded the work. Built with [Claude Code](https://claude.com/claude-code)
and the [gstack](https://github.com/garrytan/gstack) toolkit.

## Contributing

Open issues for bugs, content corrections, or works that fit the catalog.
Pre-launch work follows the roadmap in `TODOS.md`.
</content>
</invoke>