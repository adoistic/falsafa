# Falsafa

A premium reading platform for translated philosophical and classical texts,
plus an open-source MCP engine so any LLM (Claude, ChatGPT, Hermes, etc.) can
query the corpus as a knowledge resource.

> Free, public, open-source. Built by [Adnan](https://meetadnan.com).

## What this is

Two artifacts that share one corpus:

1. **A static reading site** at the editorial-quality bar of NYRB / LRB / Aeon.
   38 works, 1,673 chapters, ~4.7M tokens of translated, transliterated, and
   original-language text. Three chapter layouts: prose, verse, and manuscript.
   Reader's notebook (highlights, notes, doubts) stored locally in the browser
   with portable export to any major LLM platform.

2. **An open-source MCP server** (`@falsafa/mcp`) that exposes the corpus as
   tools to any MCP-aware LLM. Karpathy-flavored: a librarian, not a second
   LLM. Eight tools (list_works, list_chapters, get_metadata, read_chapter,
   get_passage, search_corpus, find_related, compare_works). Zero API keys,
   zero state, zero inference cost. Distributed via npm.

## Status

Greenfield. Plan locked. Scaffolding starts now.

- [Design document](docs/design.md) — full architecture, schema, MCP tool spec
- [Test plan](docs/eng-review-test-plan.md) — coverage diagram + 16-case MCP eval suite
- [DESIGN.md](DESIGN.md) — visual identity (typography, color, spacing, states)
- [TODOS.md](TODOS.md) — V2 backlog and content workstreams

## Repo layout (target)

```
falsafa/
├── corpus/                     # markdown source of truth (~25MB)
│   ├── manifest.json           # catalog: works, authors, eras, genres
│   ├── works/{era}/{author}/{slug}/
│   │   ├── index.md            # work metadata + TOC
│   │   ├── cover.webp          # AI-generated cover
│   │   ├── chapters/NN-{slug}.md
│   │   └── paragraphs.json     # stable paragraph IDs for citation
│   └── home/                   # featured.yaml, curated-paths.yaml, click-prompts.yaml
├── apps/
│   ├── site/                   # Astro 5 reading site → Vercel
│   └── mcp/                    # Bun + TypeScript MCP server → npm
├── packages/
│   └── schema/                 # shared Zod types
├── scripts/
│   ├── corpus-audit.ts         # Phase 0 — data quality pass
│   ├── convert.ts              # Phase 1 — JSON → Markdown
│   ├── cross-link.ts           # build-time TF-IDF + structural cross-links
│   └── generate-images.ts      # Phase 4 — Replicate Flux dev
├── DESIGN.md
├── TODOS.md
├── docs/
└── works.json                  # original Postgres export (archived)
```

## Quick start

```bash
# Install
bun install

# Phase 0: corpus audit (no API key needed)
bun run audit

# Phase 1: convert works.json → corpus/ markdown
bun run convert

# Phase 2: dev the MCP server (no API key needed)
cd apps/mcp && bun run dev

# Phase 4: cover imagery (needs OPENROUTER_API_KEY in .env)
echo "OPENROUTER_API_KEY=sk-or-..." > .env
bun run images                  # full pipeline: background → elements → composite
bun run images --background     # just regenerate the shared base background
bun run images --elements       # just regenerate per-work foreground motifs
bun run images --composite      # just composite (uses existing background + elements)
bun run images --only <slug>    # restrict to one work
bun run images --force          # ignore caches
bun run images --dry-run        # print prompts, don't call API
```

## Cover imagery — agentic pipeline

Falsafa covers are produced by a five-stage agentic pipeline with cross-vendor
critique. Every cover gets a watercolor prompt drafted, critiqued by a
different model, refined, and rendered. Every stage's input + output is
persisted to `cover.audit.json` for full reproducibility.

```
For each work:
  ┌─────────────────────────────────────────────────────────────────┐
  │  STAGE 1  Context        load metadata + first-chapter excerpt   │
  │                          + series anchor (palette/mood)          │
  │           (no LLM)                                                │
  ├─────────────────────────────────────────────────────────────────┤
  │  STAGE 2  Draft          claude-sonnet-4.6  json_schema          │
  │                          composes a watercolor prompt: subject,  │
  │                          palette (real pigment names), composition,│
  │                          watercolor treatment, full paragraph    │
  ├─────────────────────────────────────────────────────────────────┤
  │  STAGE 3  Critique       gpt-5.5  json_schema  CROSS-VENDOR      │
  │                          finds AI-slop, hedging, vague subject,  │
  │                          watercolor-as-label, palette drift.     │
  │                          gate: any critical issue → regenerate.  │
  │                          (Pattern adapted from gstack /codex.)   │
  ├─────────────────────────────────────────────────────────────────┤
  │  STAGE 4  Decide         claude-sonnet-4.6  json_schema          │
  │                          accepts/rejects each suggestion with    │
  │                          reasoning, emits final prompt           │
  ├─────────────────────────────────────────────────────────────────┤
  │  STAGE 5  Image          gpt-5.4-image-2  3:2 @ 2K               │
  │                          renders the final prompt → cover.webp   │
  ├─────────────────────────────────────────────────────────────────┤
  │  STAGE 6  Audit          full I/O of every stage saved to        │
  │                          cover.audit.json — replayable forever   │
  └─────────────────────────────────────────────────────────────────┘
```

**Why cross-vendor critique:** the drafter (Anthropic) and critic (OpenAI) are
different models from different labs. When they disagree, you get genuine
fresh perspective on what's wrong with the prompt. When they agree, signal is
much stronger than self-review. Same pattern gstack uses for `/codex review`
of Claude-authored code.

**Series-aware cohesion:** works are grouped into series via `lib/series.ts`
(Cynewulf trilogy, Iqbal Bang-E-Dara parts, Comte volumes, Sanskrit smṛti,
Kawi tattva, etc). Each series has a palette + mood + watercolor-treatment
anchor in `style-guide.json` that the drafter follows. Siblings read as
related; different series look genuinely different.

**Reproducibility:** `cover.audit.json` per work captures every stage's I/O.
Bumping `version` in `style-guide.json` invalidates all audits and forces
re-run. The same inputs always produce the same audit (modulo LLM sampling).

**Iteration:** edit the master aesthetic, series anchors, or system prompts
in `style-guide.json` and re-run with `--force`. Use `--dry-run` to see the
final prompt without spending an image-gen API call (saves stages 1-4 to
`cover.audit.draft.json`).

**Cost & time:** ~$0.11 per cover (3 LLM calls + 1 image gen), ~4 minutes per
cover, ~$4 and ~1 hour for the full 38-work catalog at concurrency 3.

## License

MIT. See [LICENSE](LICENSE).

The corpus content (`works.json` and the generated `corpus/` directory) is
released as a public good. Translations and transliterations are produced by
[Thothica](https://thothica.com), an AI translation company.

## Acknowledgments

- The corpus draws on public-domain originals from sources including
  [sacred-texts.com](https://sacred-texts.com).
- Thothica's translation and curation pipeline is built on frontier large
  language models (Anthropic's Claude, OpenAI's GPT, Google's Gemini, and
  open-weights models via OpenRouter). The translations and transliterations
  shipped in this corpus are the output of that pipeline. Without those
  models, Thothica could not have produced this catalog at this scale.
- Karpathy's [vector-DB-less RAG gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
  is the philosophical anchor for the MCP design.
- This site and the MCP server are built with [Claude Code](https://claude.com/claude-code)
  and the [gstack](https://github.com/garrytan/gstack) toolkit, which made it
  possible to ship a full plan + design + implementation in a single weekend.

## Contributing

Greenfield. The plan is locked at the design level (see `docs/design.md`).
Open issues for bugs, content corrections, or content contributions
(additional translated works that fit the catalog).
