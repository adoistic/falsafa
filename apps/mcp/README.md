# Falsafa MCP

Stdio MCP server for the Falsafa corpus. Ten librarian-flavored tools so any
LLM client (Claude Desktop, Claude Code, Cursor, Codex, or any MCP-aware host)
can navigate 37 translated philosophical and classical works through
paragraph-stable citations. No API key, no setup beyond `npx`.

```bash
npx -y @falsafa/mcp
```

Install from the npm registry, not from a git URL — git installs trigger the
package's `prepack` hook, which depends on the source tree's `corpus/`
directory and `bun`. Registry installs ship the corpus pre-bundled in the
tarball.

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

### Cursor / Codex / any stdio MCP client

Point your client at the command:

```bash
npx -y @falsafa/mcp
```

## Tools

Ten tools. Eight for catalog navigation, two for the rule-based wiki layer.

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

## What's in the corpus

37 works spanning Old English Christian poetry (Cynewulf), Urdu ghazal masters
(Ghalib, Iqbal, Zauq), French Enlightenment political theory (Comte, Dunoyer),
German philosophical writing (Fichte), Sanskrit smṛti traditions, and Old
Javanese / Kawi tattva texts. Each work ships with the original-language
source, a Latin-script transliteration where it makes sense, and an English
translation. Every paragraph has a stable content-derived ID (`p-xxxxxx`) so
citations survive reformatting.

**Translations and transliterations are AI-assisted.** AI can make
mistakes — when accuracy matters, verify against the original-language
source linked on each chapter page. Translations are produced by
[Thothica](https://thothica.com)'s pipeline across Claude / GPT / Gemini.
Underlying source archives:

- **Old English** (Cynewulf, OE Elegies) — [sacred-texts.com](https://sacred-texts.com/)
- **Sanskrit smṛti corpus** — [GRETIL](http://gretil.sub.uni-goettingen.de/gretil.html), Göttingen Register of Electronic Texts in Indian Languages
- **Allama Iqbal** (Bāng-i-Darā) — [allamaiqbal.com](http://allamaiqbal.com), Iqbal Academy Pakistan
- **Mirza Ghalib + Sheikh Ibrahim Zauq** — printed editions

Full source acknowledgments at [falsafa.ai/about/#sources](https://falsafa.ai/about/#sources).

## Links

- **falsafa.ai** — reading site, eval explorer, thesis on why this design
- **falsafa.ai/thesis/#methodology** — how eval scoring works (deterministic citation check; no LLM judge)
- **GitHub** — [adoistic/falsafa](https://github.com/adoistic/falsafa) for source

## License

MIT.
