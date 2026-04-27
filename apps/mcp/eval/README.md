# Falsafa MCP — Black-Box Eval Suite

This is the high-fidelity black-box eval for the Falsafa MCP server. It spawns
a fresh LLM context (default Claude Sonnet via OpenRouter) with **only** the
falsafa MCP attached — no corpus context, no priors — and asks 16 corpus
questions taken verbatim from `docs/eng-review-test-plan.md` §"MCP Black-Box
Eval Suite". Each answer is scored on a 3-axis rubric. CI gates merges into
`apps/mcp/*` on the result.

The premise: if a frontier LLM with no priors can't navigate the corpus to
answer a real question through these tools, the **tools** are wrong, not the
LLM. Failures here drive tool-surface redesign.

## Quick start

```sh
# from repo root
export OPENROUTER_API_KEY=sk-or-...

# all 16 cases (run from apps/mcp)
cd apps/mcp && bun run eval

# single case
cd apps/mcp && bun run eval:case -- --case factual-cynewulf

# different model
EVAL_MODEL=openai/gpt-4o bun run eval
EVAL_MODEL=nousresearch/hermes-3-llama-3.1-405b bun run eval
```

The harness boots `apps/mcp/src/index.ts` as a stdio child process via the
`@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`. It hands the
LLM the full tool list verbatim, runs the function-calling loop (cap 10 tool
calls + 30 s wall-clock per case), and captures every `tool_use`, the final
assistant text, and any errors.

## Files

- `cases.json` — 16 cases. Each has `id`, `category`, `prompt`,
  `expected_tool_calls`, `expected_answer_contains`, optional
  `must_not_hallucinate`, `expects_citation`, and `notes`.
- `run-evals.ts` — harness orchestrator: boot MCP, spawn chat loop, score,
  write report.
- `judge.ts` — LLM-as-judge for axes (b) and (c).
- `results/<timestamp>.json` — archival record of every run.

## The 16 cases (categories)

Verbatim from the test plan:

1. Factual lookup — "What works did Cynewulf write?"
2. Cross-text discovery — "Where in the corpus is dharma discussed?"
3. Author comparison — Cynewulf vs Iqbal on the divine
4. Citation precision — passage about courage from Andreas with line numbers
5. Onboarding discovery — first work for someone new to Old English
6. Negative case — works in Tamil (must NOT hallucinate)
7. Cross-language reasoning — Iqbal passages resonant with Andreas
8. Difficulty-aware retrieval — most accessible Sanskrit work
9. Content-type-aware retrieval — works in their original language only
10. Translation-aware retrieval — Thothica's translations
11. Era-bounded query — medieval philosophical works
12. Genre-bounded query — list all literary works
13. Multi-step reasoning — of works mentioning 'divine,' which has highest word count
14. Edge: out-of-range — chapter 999 of Andreas
15. Edge: invalid filter — language called 'martian'
16. Citation fidelity — exact opening line of Andreas

## Scoring — the 3-axis rubric

Per case, score each axis 0 or 1; total ranges 0–3.

- **(a) Correct tool calls** — mechanical. Pass if at least one of
  `expected_tool_calls` appears in the trace. Order does not matter; partial
  match is acceptable.
- **(b) Factually correct answer** — judge LLM (default
  `anthropic/claude-opus-4.5`). Pass if the answer references the expected
  facts and doesn't contradict the corpus. Forced to 0 if any
  `must_not_hallucinate` string appears in the answer (case-insensitive
  substring).
- **(c) Citation-backed** — judge LLM. Only meaningful when
  `expects_citation: true`. Pass if the answer cites a work + chapter
  (paragraph_id is nice-to-have).

**Failure threshold (CI gate):** any case scoring < 2/3 fails. The harness
exits non-zero if any case fails.

## Output

Real-time per-case lines on stdout, e.g.:

```
PASS factual-cynewulf                      [3/3]  a=1 b=1 c=1  tools=[list_works]  4123ms
FAIL negative-tamil                        [1/3]  a=1 b=0 c=1  tools=[list_works]  3210ms  HALLUCINATION
```

A summary table prints at the end. A full JSON report is written to
`apps/mcp/eval/results/<timestamp>.json`.

## Costs

Per run, all 16 cases:

- **Eval model** (Sonnet 4.5 via OpenRouter): ~16 × ~5 OpenRouter calls per
  case × ~3k tokens / call ≈ **240k tokens** in/out. At Sonnet's pricing
  (~$3/M in, $15/M out, mostly in), expect **$1–$3 per run**.
- **Judge model** (Opus 4.5): one call per case × ~1k tokens ≈ 16k tokens.
  At Opus pricing (~$15/M in, $75/M out): **$0.20–$0.60 per run**.

**Total ballpark: $2–$5 per full eval run**, matching the test plan's CI
budget estimate.

Per-case wall-clock cap is 30 s; tool-call cap is 10. A runaway loop costs
at most one case's budget.

## What failures mean

Per the test plan: 3+ evals failing across consecutive PRs signals the **tool
surface is wrong**, not just a bug. The fix is a tool redesign, not a patch.

Common failure modes and what they imply:

- (a) fails alone → tool description doesn't make the relevant tool obvious
  to the LLM. Fix the description, not the schema.
- (b) fails on negative cases → tools are returning empty without enough
  context for the LLM to assert "no matches"; consider returning an
  explicit `note: "no works match this filter"`.
- (c) fails on citation cases → tools return text but no chapter/paragraph
  pointers. Verify `paragraph_id` is in `search_corpus` and `get_passage`
  responses.
- Frequent `CHAPTER_OUT_OF_RANGE` style errors on edges (cases 14/15) → the
  error is being thrown but the LLM is not surfacing it cleanly. The error
  message itself may need an LLM-friendlier `hint`.

## Adding a case

Edit `cases.json`. Each case must have the canonical shape (see existing
entries). New cases should be drawn from a real bug or a real product
question — not a synthetic stress test.

## CI

`.github/workflows/mcp-evals.yml` runs the suite on PRs that touch
`apps/mcp/*`. Gating:

- `EVALS_REQUIRED=true` repo secret + `OPENROUTER_API_KEY` repo secret →
  full run, blocking.
- Either secret missing → skip with a warning comment on the PR. External
  contributors aren't blocked.

The workflow posts a markdown summary table to the PR via `gh pr comment`.

## Skipping locally

If `OPENROUTER_API_KEY` is unset, the harness exits 0 with a clear message
and does not run any cases. Set `EVALS_REQUIRED=true` to make a missing key
exit 2 (CI mode).
