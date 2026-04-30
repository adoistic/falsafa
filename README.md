# Falsafa

A reading site and an open-source MCP server over the same translated corpus
of philosophical and classical texts. Built by [Adnan](https://meetadnan.com).
Free, public, MIT.

The fastest way in:

```bash
npx -y @falsafa/mcp
```

That's the librarian. Eight tools (list, read, search, cite, compare),
zero API keys, zero state, zero inference cost on our side. Karpathy-flavored:
the MCP is a librarian, not a second LLM. Your model does the reasoning.

## Install in your daily LLM (30 seconds)

### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(or run `claude mcp add falsafa npx -y @falsafa/mcp`):

```json
{
  "mcpServers": {
    "falsafa": { "command": "npx", "args": ["-y", "@falsafa/mcp"] }
  }
}
```

Restart. The Falsafa tools show up in the tool list. Ask "what works does
Cynewulf have?" and the model calls `list_works({ author: "cynewulf" })`.

### Cursor / Codex / any stdio MCP client

```bash
npx -y @falsafa/mcp
```

Point your client at that command. See `apps/mcp/README.md` for the full
tool reference and example interactions.

## What's in the corpus

Numbers from `corpus/manifest.json` (regenerated on every convert):

| | Count |
|---|---|
| Works | 37 |
| Authors | 21 |
| Logical chapters | 818 |
| Variant entries (translation, transliteration, original) | 2,053 |
| Languages | Old English, Sanskrit, Urdu, Kawi, French, German |
| Eras | Ancient, Medieval, Early Modern, 19th C, 20th C |

Cynewulf's Old English Christian poems. Iqbal's Bang-E-Dara. Ghalib and
Zauq's Diwans. Sanskrit smṛti texts. Comte and Fichte. Each work ships with
the original-language source, a Latin-script transliteration where it makes
sense, and Thothica's English translation. Every paragraph has a stable
content-derived ID (`p-xxxxxx`) so citations survive reformatting.

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
├── apps/
│   ├── site/           # Astro 5 reading site + /try BYOK demo
│   ├── mcp/            # @falsafa/mcp, stdio MCP server (Bun + TS)
│   ├── pipeline/       # `npx @falsafa/pipeline ingest` (in progress)
│   └── baseline/       # hybrid RAG baseline for the eval comparison
├── eval/               # 1,000-question audited pool (Agents A/B/C)
├── scripts/            # convert, audit, cross-link, image-gen
├── docs/designs/       # locked plans (Perseus launch, BYOK slice)
└── TODOS.md            # deferred items + remote MCP gate
```

## Eval

`apps/mcp/eval/` runs 44 cases across needle quotes, vague themes, factual
lookups, citation precision, comparative reasoning, edge cases, and
adversarial negatives. Results land in `apps/mcp/eval/runs/`.

Last Haiku run: 44/44 pass, 389/396 points. Sonnet judge resolves every
cited paragraph_id back to source. The full audited 1,000-question pool
sits at `eval/questions-revised-1000.json`; the launch eval explorer at
`falsafa.ai/eval` will browse it case-by-case against a hybrid RAG baseline.

## Status

Launch phase. Plan locked at
[`docs/designs/falsafa-perseus-launch.md`](docs/designs/falsafa-perseus-launch.md).
Eleven artifacts on the launch list:

1. Writeup
2. Repo (this)
3. `falsafa.ai/try` BYOK live demo (built, undeployed)
4. `falsafa.ai/eval` eval explorer
5. `falsafa.ai/thesis` why no vector DB
6. `falsafa.ai/numbers` by-the-numbers
7. `falsafa.ai/perseus` Perseus showcase
8. `npx @falsafa/pipeline ingest <archive>` published to npm
9. gstack Skill: `gstack skills install falsafa-methodology`
10. arXiv preprint
11. PR back to PerseusDL

Phase 1 (corpus + MCP) and Phase 2 (BYOK demo at /try, end-to-end
paragraph-anchored citations) are in. Remote MCP backend (claude.ai
Connector + ChatGPT GPT) is gated on `/office-hours` then
`/plan-eng-review`; see the entry at the top of `TODOS.md`.

## Run it locally

```bash
bun install

# audit + convert (no API key needed)
bun run audit
bun run convert

# MCP server, stdio
cd apps/mcp && bun run dev

# reading site + /try BYOK demo
cd apps/site && bun run dev

# MCP eval suite (ANTHROPIC_API_KEY for Haiku, optional Sonnet judge)
cd apps/mcp && bun run eval
```

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