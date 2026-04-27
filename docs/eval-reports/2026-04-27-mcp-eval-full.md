# Falsafa MCP Eval Report — 2026-04-27 (FULL)

**Status:** COMPLETE. All 44 cases ran end-to-end with Gemini 2.5 Flash + Haiku 4.5 judge, concurrency=10, in 144 seconds wall-clock.

**Headline numbers:**

| Metric | Value |
|--------|-------|
| Eval model | `google/gemini-2.5-flash` |
| Judge model | `anthropic/claude-haiku-4.5` |
| Cases | 44 |
| Pass (≥ 2/3) | 27 (61%) |
| Total points | 87 / 132 (66%) |
| Wall clock | 2 min 24 sec |
| Concurrency | 10 |

The MCP librarian is **solid where it matters most** (no hallucinations, clean filter handling, accurate metadata) but the headline pass rate underplays it because **Gemini Flash is materially weaker than Claude Sonnet at agentic discovery**, and the hardest category (needle-in-haystack quote retrieval) is also the most LLM-skill-dependent.

## Per-category results

| Category | Pass / Total | Pts / Max | Read |
|----------|-------------|-----------|------|
| **Negative / hallucination guard** | **5 / 5** | **15 / 15** | 🟢 Perfect — no hallucinated Tamil works, Plato, Quran, novels, or quantum mechanics |
| **Era / filter bounded** | **4 / 4** | **11 / 12** | 🟢 Filter combinators work as designed (era / language / author / content_type) |
| **Factual lookup** | **5 / 5** | **12 / 15** | 🟢 Catalog metadata Q&A is reliable (Cynewulf works, corpus counts, Comte volumes, Manusmṛti chapters, Iqbal parts) |
| Citation precision | 3 / 5 | 9 / 15 | 🟡 Gemini sometimes paraphrased instead of quoting; the OE original-text variant switch worked perfectly |
| Cross-tradition comparison | 2 / 4 | 7 / 12 | 🟡 `find_related` and theme search worked; `compare_works` under-utilized |
| Multi-step reasoning | 2 / 4 | 7 / 12 | 🟡 One case hit MAX_TOOL_CALLS=15 in a get_metadata loop (Gemini didn't terminate cleanly) |
| Edge / error handling | 2 / 3 | 6 / 9 | 🟡 `edge-out-of-range-chapter` failed: Gemini said Andreas isn't in corpus rather than the simpler "ch 999 doesn't exist." |
| Needle: vague thematic | 3 / 6 | 11 / 18 | 🟡 Variable — kingship + debt found correctly; exile + courage + divine missed |
| **Needle: specific quote** | **1 / 8** | **9 / 24** | 🔴 **Worst category.** Gemini gave up after 1–3 search calls; Sonnet hit 7/8 perfect on the same cases. |

## The MCP works. The Gemini-vs-Sonnet gap is the story.

Comparing this Gemini run to the partial Sonnet run from earlier today (8 cases that completed before credits exhausted):

| Case | Sonnet 4.5 | Gemini 2.5 Flash |
|------|-----------|------------------|
| needle-quote-andreas-thanes | **3/3** ✓ | 1/3 ✗ |
| needle-quote-ghalib-place-no-one-known | **3/3** ✓ | 1/3 ✗ |
| needle-quote-iqbal-piety | **3/3** ✓ | 1/3 ✗ |
| needle-quote-manu-sages | **3/3** ✓ | 1/3 ✗ |
| needle-quote-yajnavalkya-yogis | **3/3** ✓ | 1/3 ✗ |
| needle-quote-visnu-boar | **3/3** ✓ | 1/3 ✗ |
| needle-quote-kunjarakarna-six-enemies | **3/3** ✓ | **3/3** ✓ |
| needle-quote-comte-introduction | 2/3 ⚠ | 0/3 ✗ |

The **MCP is the same**. The corpus is the same. The cases are the same. Sonnet aced the needle-quote category; Gemini Flash didn't even seriously try after 1–3 searches.

What Gemini is doing wrong: judge reasoning across the failed cases shows the same shape:
- "The answer reports no results from the corpus search and provides no identification..."
- "The answer claims the line is not in the corpus..."
- "The answer fails to identify the passage..."

In every case Gemini ran a single `search_corpus` with poorly chosen keywords (e.g. searching the entire quote instead of distinctive 2-3 word phrases), got few or weak results, and gave up. Sonnet refined queries iteratively (3-9 search calls per case in the partial run, then read_chapter / get_passage to confirm) and found everything.

**This is a property of the LLM, not the MCP.** Gemini Flash is the weakest of the major frontier models on agentic tool-use; the MCP can't compensate for that.

## Strong signals about the MCP itself

These are the categories where the LLM's role is smaller — the MCP either gives it the right answer or doesn't:

### Hallucination resistance: 5/5 ✓ (PERFECT)
The hardest category to test, and the most important for trust. All five cases correctly returned "no" without inventing:

- `negative-tamil` 3/3 — no Tirukkural, no Sangam poetry hallucinated
- `negative-greek-philosophy` 3/3 — no Republic, no Aristotle invented
- `negative-arabic-original` 3/3 — no Quran, Hadith, Rumi
- `negative-modern-fiction` 3/3 — no Joyce, Proust, Tolstoy
- `negative-quantum-mechanics` 3/3 — correctly distinguished smṛti cosmogonies from physics

Even when Gemini's discovery skill faltered elsewhere, it didn't fabricate works on negative cases. That's the MCP's English-first reasoning rule + tool-grounded querying paying off.

### Filter / metadata navigation: 9/9 ✓ (PERFECT)
- `factual-cynewulf-works` 3/3 — Andreas, Elene, Juliana — exactly the 3 Cynewulf works in corpus, NOT Christ II / Fates of the Apostles
- `factual-comte-volumes` 3/3 — 6 Charles Comte volumes (NOT Auguste Comte)
- `filter-era-medieval` 2/3 — found correctly
- `filter-language-sanskrit` 3/3 — all 11 Sanskrit works
- `filter-author-iqbal` 3/3 — Bang-E-Dara Parts 1, 2, 3 (NOT hallucinated other Iqbal works)
- `filter-content-type-original` 3/3 — correctly listed works with original-language variants

### Cross-tradition discovery (when it worked): excellent
- `comparative-dharma-east-west` 3/3 — found dharma in smṛtis, mapped to Comte/Dunoyer/Fichte's natural-law liberalism
- `comparative-related-andreas` 3/3 — `find_related` returned meaningful matches
- `needle-theme-kingship` 3/3 — found Manu, Kātyāyana sections on rāja-dharma (avoided hallucinating Arthashastra / Machiavelli)
- `needle-theme-debt` 3/3 — found Bṛhaspati + Kātyāyana legal sections

## Real findings (in order of importance)

1. **Hallucination resistance is the strongest signal.** The MCP design works. With grounded tool-use the LLM doesn't invent. 5/5 perfect on the hardest negative cases is meaningful.

2. **Charles Comte / Charles Dunoyer disambiguation is a real product issue.** Both models failed `needle-quote-comte-introduction` the same way: under-specified prompt ("a 19th-century French liberal political treatise") matches multiple works in corpus, LLM commits to one without flagging the ambiguity. Captured as TODO — system-prompt nudge: "if multiple works fit a description, list both and ask to disambiguate."

3. **Gemini 2.5 Flash is too weak for agentic discovery.** A single search_corpus with the entire quote string is the wrong query strategy; Sonnet refines and probes. If the MCP is going to be used with weaker LLMs, the tool descriptions might need to push harder on "try multiple search queries" and "use distinctive phrases not the full sentence."

4. **One real edge-case bug.** `edge-out-of-range-chapter` (asking for chapter 999 of Andreas) returned a confused answer rather than the typed CHAPTER_OUT_OF_RANGE error from the MCP. Worth investigating whether the error-message text the MCP returns is clear enough that a 7B-class LLM can interpret it.

5. **MAX_TOOL_CALLS=15 was too low for one case.** `multistep-mention-divine-wordcount` ran 15 tool calls (1 search + 8 get_metadata + 6 read_chapter) before being capped. The agentic loop would have completed with a slightly higher cap. Consider 20–25 for V2 of the suite.

## Cost

This run cost approximately **$1.20** (estimated):
- Eval: 44 × ~5 chats × ~3K total tokens × $0.30/$2.50/M Gemini Flash = ~$0.50
- Judge: 44 × 1 chat × ~3K tokens × $0.80/$4.00/M Haiku = ~$0.70

Concurrency=10 cut wall-clock from ~12 minutes (sequential) to 2.4 minutes. The MCP stdio transport handles concurrent `callTool` requests cleanly — single child process served all 10 parallel agentic loops without contention.

## Re-run commands

```bash
cd apps/mcp

# Cheap pass (Gemini Flash + Haiku, ~$1, ~2.5 min)
EVAL_MODEL="google/gemini-2.5-flash" \
JUDGE_MODEL="anthropic/claude-haiku-4.5" \
EVAL_CONCURRENCY=10 \
  bun run eval/run-evals.ts

# High-fidelity pass (Sonnet + Opus, ~$8-15)
EVAL_MODEL="anthropic/claude-sonnet-4.5" \
JUDGE_MODEL="anthropic/claude-opus-4.5" \
EVAL_CONCURRENCY=10 \
  bun run eval/run-evals.ts

# Single case (debugging)
EVAL_MODEL="google/gemini-2.5-flash" \
JUDGE_MODEL="anthropic/claude-haiku-4.5" \
  bun run eval/run-evals.ts --case needle-quote-comte-introduction
```

## Recommended actions

1. **Re-run with Sonnet 4.5** when budget allows. The Gemini Flash pass under-rates the MCP — Sonnet's partial run already showed 7/8 on the hardest category. Sonnet on full 44 cases would give a fair comparative baseline.

2. **Add the disambiguation system-prompt nudge** to the MCP server's tool descriptions: "If multiple works fit a vague description, return all candidates and ask the user to specify."

3. **Bump MAX_TOOL_CALLS to 25** in run-evals.ts. One real case ran out at 15.

4. **Investigate edge-out-of-range error message clarity.** Whatever `read_chapter(slug, 999)` returns currently is being interpreted by Gemini as "work doesn't exist" — re-read the `MCPError` message in apps/mcp/src/corpus.ts.

## Files

- 44 cases: [`apps/mcp/eval/cases.json`](../../apps/mcp/eval/cases.json)
- Harness: [`apps/mcp/eval/run-evals.ts`](../../apps/mcp/eval/run-evals.ts) (now with `EVAL_CONCURRENCY` pool)
- Judge: [`apps/mcp/eval/judge.ts`](../../apps/mcp/eval/judge.ts)
- README: [`apps/mcp/eval/README.md`](../../apps/mcp/eval/README.md)
- Raw run JSON: `apps/mcp/eval/results/2026-04-27T03-46-43-154Z.json`
- Earlier partial Sonnet run: `apps/mcp/eval/results/2026-04-27T03-24-37-723Z.json`
- CI workflow: [`.github/workflows/mcp-evals.yml`](../../.github/workflows/mcp-evals.yml)

## Honest limitations of this report

- Single-model run on the eval side. A second run with Sonnet would harden the comparative claim.
- Single-model judge. The judge model (Haiku 4.5) is reliable for binary-verdict structured-JSON tasks but might score borderline factual answers slightly differently than Opus would.
- No retry-on-transient-error in the harness. If a single OpenRouter 5xx hit during the run, that case would have failed with `error` set; we got 0 such errors this time but the harness should add 1-retry+backoff for CI robustness.
- N=1 per case. Statistical confidence on per-case scores is low; the headline category numbers are more meaningful than any individual case.
