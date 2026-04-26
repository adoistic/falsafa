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

Not yet runnable. Phase 0 (corpus audit) starts after this initial commit.

## License

MIT. See [LICENSE](LICENSE).

The corpus content (`works.json` and the generated `corpus/` directory) is
released as a public good. Translations and transliterations are produced by
[Thothica](https://thothica.com), an AI translation company.

## Acknowledgments

- The corpus draws on public-domain originals from sources including
  [sacred-texts.com](https://sacred-texts.com).
- Thothica's translations and curation make this corpus accessible.
- Karpathy's [vector-DB-less RAG gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
  is the philosophical anchor for the MCP design.

## Contributing

Greenfield. The plan is locked at the design level (see `docs/design.md`).
Open issues for bugs, content corrections, or content contributions
(additional translated works that fit the catalog).
