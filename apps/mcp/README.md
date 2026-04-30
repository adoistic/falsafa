# @falsafa/mcp

Open-source MCP server for the Falsafa corpus — 37 classical and philosophical
works (2,053 variant entries / 818 logical chapters) translated, transliterated,
and curated by [Thothica](https://thothica.com).

Plug it into any MCP-aware LLM (Claude Desktop, Cursor, Codex, etc.) and your
chosen model can navigate the corpus directly: list works, read chapters, search
across the catalog, find related passages, compare works on a topic.

## Design philosophy

The MCP is a **librarian, not a second LLM**. Tools return text and structure;
the host LLM does all the reasoning. No API keys, no inference cost, no model
lock-in. Inspired by Karpathy's
[vector-DB-less RAG gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## Install

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "falsafa": {
      "command": "npx",
      "args": ["-y", "@falsafa/mcp"]
    }
  }
}
```

Restart Claude Desktop. The Falsafa tools appear in the tool list.

### Cursor / Codex / other MCP clients

```bash
npx @falsafa/mcp
```

Then point your MCP client at this stdio command.

### Use a custom corpus path

```bash
FALSAFA_CORPUS=/path/to/your/corpus npx @falsafa/mcp
```

## Tools

| Tool | What it does |
|------|--------------|
| `list_works` | List works, optionally filtered by era / author / language / genre |
| `list_chapters` | List chapters in a work with their layouts and variants |
| `get_metadata` | Full metadata for a work (author bio, layouts, variant types) |
| `read_chapter` | Read a chapter's full text (specify variant for multilingual works) |
| `get_passage` | Get specific paragraphs for precise citation (paragraph IDs are stable) |
| `search_corpus` | Search across the corpus (default scope: English translations + native English) |
| `find_related` | Find related works via structural signals (same author / era / genre) |
| `compare_works` | Compare two works on a topic — returns chapter pointers, host LLM reasons |

## Example interactions (in Claude Desktop)

**You:** What works are by Cynewulf?
**Claude → MCP:** `list_works({ author: "cynewulf" })`
**Claude:** Andreas, Elene, Juliana — three Old English Christian poems...

**You:** Show me chapter 1 of Andreas.
**Claude → MCP:** `read_chapter("cynewulf-andreas-07b573", 1)`
**Claude:** *(displays the Old English text, or the translation if you ask)*

**You:** Find passages about courage in the Sanskrit smṛti texts.
**Claude → MCP:** `search_corpus("courage", { scope: "english" })`
**Claude:** *(returns matches with paragraph IDs for citation)*

**You:** Compare how Cynewulf and Iqbal treat the divine.
**Claude → MCP:** `compare_works(cynewulf_slug, iqbal_slug, "divine")`
**Claude:** *(reads both, synthesizes the comparison)*

## Multilingual variants

Each logical chapter ships with 1-3 language variants:

- `original` — the source-language text (Old English, Sanskrit, Urdu, etc.)
- `transliteration` — Latin-script romanization (where applicable)
- `translation` — Thothica's English translation

`read_chapter` returns the default variant (translation when present, else
original). Specify `variant` to read a specific one. `search_corpus` defaults
to English content; pass `scope: "all"` to search across all variants.

## Stable paragraph citations

Every paragraph in every variant has a stable ID (a 6-char FNV-1a hash of the
paragraph's content, prefixed `p-`). `get_passage` accepts these IDs for
precise citation. They survive markdown reformatting because they're derived
from content, not line numbers.

## Repo

[github.com/adoistic/falsafa](https://github.com/adoistic/falsafa) — MIT licensed.

## License

MIT
