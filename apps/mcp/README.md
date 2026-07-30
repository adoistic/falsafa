# Falsafa MCP

Stdio MCP server for the Falsafa corpus. Fifteen librarian-flavored tools so any
LLM client (Claude Desktop, Claude Code, Cursor, Codex, or any MCP-aware host)
can navigate 2,018 philosophical and classical works through
paragraph-stable citations. No API key, no setup beyond `npx`.

```bash
npx -y @falsafa/mcp
```

Install from the npm registry, not from a git URL — git installs trigger the
package's `prepack` hook, which depends on the source tree's `corpus/`
directory and `bun`.

> **First run downloads the corpus snapshot (~500 MB compressed, ~2 GB on disk)** from a GitHub release into your cache directory, verifies its checksum, and builds a local search index. The npm package itself is ~100 KB. If
> your MCP client's startup timeout is short — Claude Code in particular —
> run `npx -y @falsafa/mcp` once in a terminal first. npm caches the
> package, and your client's spawn resolves instantly thereafter.

## Install in your daily LLM

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

### Claude Code

```bash
claude mcp add falsafa npx -y @falsafa/mcp
```

### Cursor

Settings → **MCP** → *Add new global MCP server*, paste:

```json
{
  "mcpServers": {
    "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] }
  }
}
```

Or edit `~/.cursor/mcp.json` directly with the same shape.

### Codex CLI

```bash
codex mcp add falsafa -- npx -y @falsafa/mcp
```

Persists in `~/.codex/config.toml`. The `--` separator is required.

### Any other stdio MCP client

The universal config shape is:

```json
{ "command": "npx", "args": ["-y", "@falsafa/mcp"] }
```

Drop that wherever your client expects an MCP server entry.

## Tools

Fifteen tools. Eight for catalog navigation, two for the rule-based wiki layer,
five for the Atlas — the ontology layer over the corpus.

- **`list_works`** — list works in the corpus with optional author / era / genre / language filters
- **`list_chapters`** — list chapters of a specific work
- **`get_metadata`** — full metadata + variant counts for a work
- **`read_chapter`** — full chapter text. Body is annotated with `[p-XXXXXX]` paragraph-id markers; use those for paragraph citations.
- **`get_passage`** — read specific paragraphs by id list or 0-indexed range. Each result has a `citation_url` ready to drop into a markdown footnote.
- **`search_corpus`** — search English bodies. Distinctive 2-3 word phrases work best.
- **`find_related`** — TF-IDF-based related chapters, with a structural fallback.
- **`compare_works`** — side-by-side pointer chapters for two works on a topic.
- **`read_wiki`** — rule-based wiki card (~280 tokens) for a work or chapter. Use BEFORE `read_chapter` to scan what's worth a deep read. Cards are deterministic, generated from the corpus by classical statistical algorithms — zero LLM tokens in any output. Each card includes verbatim openings, closings, and key passages with `[p-XXXXXX]` cite handles.
- **`read_wiki_full`** — heavier wiki sheet (~1,500 tokens) with the deeper statistical detail layered on top of the card. Opt-in for deep analysis; most queries should use `read_wiki` first and only escalate when needed.

### The Atlas

The Atlas is an ontology extracted from the corpus: named entities and where
they occur, per-work chapter rosters, and a citation graph with stances. It is
read lazily from `https://falsafa.ai/corpus/graph/atlas/` — set
`FALSAFA_ATLAS_URL` to point elsewhere, or drop a `graph/atlas/` directory into
the corpus root to read it from disk. Nothing is fetched unless you call one of
these tools.

- **`atlas_search`** — find a figure, place, group, idea, object, event, or animal by name or by any alias the texts use (`son of Kronos` → Zeus; `Sakra` → Indra, diacritics folded). Returns the `kind` + `slug` the next tool needs.
- **`atlas_entity`** — an entity's dossier: every work that mentions it, what it does in each, and verbatim quotes with `paragraph_id` + `citation_url`.
- **`atlas_work`** — which entities appear in which chapters of one work, its top entities, and how completely that work has been processed.
- **`atlas_citations`** — who quotes or invokes whom, with a stance (`authority` / `endorse` / `refute` / `extend` / `neutral`) and citable quotes. `cited_work_in_corpus` says whether the cited text is readable here.
- **`atlas_coverage`** — live coverage counters: works processed vs total, windows synthesized vs total, and the same split by language and by era.

**The Atlas is partial and still being built** — a minority of works have been
through extraction so far, while the corpus itself is complete and fully
readable. Every `atlas_*` response therefore carries an `atlas_coverage` block
with the current numbers, and a work absent from the Atlas is *not* absent from
the corpus: it simply has not been processed yet. Use `search_corpus` when you
need to be sure about what the corpus does or does not contain.

## What's in the corpus

2,018 works across 9 languages — Greek, Latin, Sanskrit, Urdu, Old English,
Kawi, French, German, and English — from the Rigveda, Homer and the Greek
historians through the Sanskrit epics and smṛti law books, Old Javanese
tattva texts, Anglo-Saxon poetry and Urdu ghazals, to the philosophy and
political economy of the 17th–20th centuries. Works carry the
original-language source beside an English translation, plus a Latin-script
transliteration where it makes sense. Every paragraph has a stable
content-derived ID (`p-xxxxxx`) so citations survive reformatting.

The corpus is not bundled in the npm package; the first run downloads a
snapshot (~2 GB on disk) from a GitHub release and caches it.

**Zero-download (remote) mode.** Set `FALSAFA_CORPUS_URL=https://falsafa.ai/corpus/`
and the server serves the corpus straight from the CDN over HTTP — no download,
instant startup. Navigation, reading, wiki cards, and related-works all work;
only full-text passage search is unavailable in this mode (it returns metadata
matches instead — use the default download mode for full-text search). Requires
`curl` on PATH.

**Translations and transliterations are AI-assisted.** AI can make
mistakes — when accuracy matters, verify against the original-language
source linked on each chapter page. Translations are produced by
[Thothica](https://thothica.com)'s pipeline across Claude / GPT / Gemini.
Underlying source archives include:

- **Greek and Latin classics** — [Perseus Digital Library](https://www.perseus.tufts.edu/)
- **Sanskrit corpus** (Vedas, epics, smṛtis) — [GRETIL](http://gretil.sub.uni-goettingen.de/gretil.html), Göttingen
- **Modern philosophy and political economy** — [Project Gutenberg](https://www.gutenberg.org/), [Liberty Fund / OLL](https://oll.libertyfund.org/), [Marxists Internet Archive](https://www.marxists.org/)
- **18th-century English poetry** — [ECPA](https://www.eighteenthcenturypoetry.org/) (Bodleian)
- **Old English** (Cynewulf, OE Elegies) — [sacred-texts.com](https://sacred-texts.com/)
- **Allama Iqbal** (Bāng-i-Darā) — [allamaiqbal.com](http://allamaiqbal.com), Iqbal Academy Pakistan

Full source acknowledgments at [falsafa.ai/about/#sources](https://falsafa.ai/about/#sources).

## Links

- **falsafa.ai** — reading site, eval explorer, thesis on why this design
- **falsafa.ai/thesis/#methodology** — how eval scoring works (deterministic citation check; no LLM judge)
- **GitHub** — [adoistic/falsafa](https://github.com/adoistic/falsafa) for source

## License

MIT.
