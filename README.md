# Falsafa

A reading site and an open-source MCP server over the same translated corpus
of philosophical and classical texts. Built by [Adnan](https://meetadnan.com).
Free, public, MIT.

The fastest way in:

```bash
npx -y @falsafa/mcp
```

That's the librarian. Ten tools (list, read, search, cite, compare, plus
the rule-based wiki layer — `read_wiki` and `read_wiki_full`),
zero API keys, zero state, zero inference cost on our side. Karpathy-flavored:
the MCP is a librarian, not a second LLM. Your model does the reasoning.

> First run downloads ~48 MB (the corpus ships inside the tarball). If your
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

**Translations are AI-assisted.** AI can make mistakes — when accuracy
matters, verify against the original-language source linked on each
chapter page. The translations are produced by Thothica's pipeline
across frontier LLMs (Claude / GPT / Gemini); the original-language
texts come from public archives.

### Sources

The source texts come from freely available digital archives plus
transcribed printed editions:

- **Old English** (Cynewulf's Juliana / Elene / Andreas; OE Elegies) — [sacred-texts.com](https://sacred-texts.com/)
- **Indian Sanskrit smṛti** (Manu, Yājñavalkya, Viṣṇu, Nārada, Bṛhaspati, Parāśara, Aṅgirasa) — [GRETIL](http://gretil.sub.uni-goettingen.de/gretil.html), Göttingen Register of Electronic Texts in Indian Languages
- **Allama Iqbal** (Bāng-i-Darā parts 1-3) — [allamaiqbal.com](http://allamaiqbal.com), Iqbal Academy Pakistan
- **Mirza Ghalib + Sheikh Ibrahim Zauq** (Urdu diwans) — printed editions

Same list with full citations on the deployed site at `/about/#sources`.

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

Launch phase. Plan locked at
[`docs/designs/falsafa-perseus-launch.md`](docs/designs/falsafa-perseus-launch.md).
Eleven artifacts on the launch list:

| # | Artifact | State |
|---|---|---|
| 1 | Writeup | pending |
| 2 | Repo (this) | ✅ |
| 3 | `falsafa.ai/try` BYOK live demo | ✅ [live](https://www.falsafa.ai/try/) (tabbed Install / BYOK) |
| 4 | `falsafa.ai/eval` eval explorer | ✅ [live](https://www.falsafa.ai/eval/) (A/B baseline vs wiki) |
| 5 | `falsafa.ai/thesis` why no vector DB | ✅ [live](https://www.falsafa.ai/thesis/) (with `#methodology` + A/B benchmark) |
| 6 | `falsafa.ai/numbers` by-the-numbers | ✅ [live](https://www.falsafa.ai/numbers/) |
| 7 | `falsafa.ai/perseus` Perseus showcase | pending |
| 8 | `npx @falsafa/mcp` published to npm | ✅ [v0.1.2 live on npm](https://www.npmjs.com/package/@falsafa/mcp) |
| 9 | `falsafa.ai` deployed to Vercel | ✅ live; auto-deploys from `main` |
| 10 | gstack Skill: `gstack skills install falsafa-methodology` | pending |
| 11 | arXiv preprint | pending — gated on graded-score eval rework (`TODOS.md`) |
| 12 | PR back to PerseusDL | pending |

The corpus + MCP (Phase 1), BYOK demo at `/try` (Phase 2), and the
eval explorer + thesis methodology + redesigned A/B benchmark chart
(Phase 3) are all in and deployed. Vercel auto-deploys every push to
`main`. Remote MCP backend (claude.ai Connector + ChatGPT GPT) is
gated on `/office-hours` then `/plan-eng-review`; see the entry at
the top of `TODOS.md`.

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

# MCP eval suite (deterministic citation-based scoring against expected_works)
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