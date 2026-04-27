---
status: ACTIVE
---

# Eval Protocol — How a question becomes a result

This document is the technical record of how Falsafa runs its black-box
adversarial eval. The point of writing it down: anyone — a reader of the
preprint, an MCP user reproducing the result, a future Falsafa contributor
— can replicate the setup with no information asymmetry.

## Ecological validity

The eval protocol is **identical to the experience of a real user
installing `@falsafa/mcp`**. There is no special harness, no privileged
access, no parallel implementation. The agent runs in a fresh LLM
session with the Falsafa MCP attached the same way Claude Desktop /
Cursor / Codex CLI users attach it: through the standard MCP config
file. When the agent calls `mcp__falsafa__search_corpus`, it hits the
same code path your session does when you ask Claude "what does Ghalib
say about ..." after `npx -y @falsafa/mcp`.

The only thing the eval adds is anti-cheat scaffolding (forbid the
agent from reading our ground-truth files) and structured output (the
agent writes a JSON answer + tool trace + citations to disk). Strip
those two layers and the protocol IS a normal MCP-user session.

## The four pieces

```
question → blind prompt → fresh agent session w/ MCP → JSON result on disk
```

### 1. The question

Pulled from `eval/questions-revised-1000.json`. Each entry has:

```json
{
  "id": "q-0001",
  "category": "citation",
  "difficulty": "medium",
  "prompt": "What does Ghalib's ghazal 'Aah ko chahiye ik umr asar hote tak' say about ...?",
  "rationale": "...",            // ground truth — never shown to agent
  "expected_works": [...],       // ground truth — never shown to agent
  "quality": {...}               // calibration metadata
}
```

### 2. The blind prompt

Constructed by `apps/mcp/eval/run-subagent-evals.ts` `buildSubagentPrompt(case, runDir)`
or `buildNativeMcpPrompt(case, runDir)`. Both versions take ONLY the
question's `id` and `prompt` fields. Ground-truth fields
(`rationale`, `expected_works`, `quality`) are never read by the
prompt builder.

The prompt has four parts:

1. **Anti-cheat block** (forbids reading the question pool file, prior
   results, judge verdicts, or eval reports — see below for the
   complete list).
2. **The question** — verbatim from `prompt`.
3. **Tool spec** — describes the eight `mcp__falsafa__*` tools, search
   strategy, and the corpus's actual languages (so the agent doesn't
   hallucinate Tamil works).
4. **Response format** — the agent must produce a JSON object with
   `answer`, `tool_calls`, and `citations`, written to a per-question
   file AND echoed in the final message as a fenced ```json block.

### 3. The agent session

A fresh Claude Code sub-agent session, dispatched via the Agent tool
with `subagent_type: "general-purpose"` and a model selector
(`sonnet`, `haiku`, `opus`, or codex via `~/.codex/config.toml`).

The Falsafa MCP is attached at session start through the user's
`~/.claude.json` or `~/.codex/config.toml`:

```json
// ~/.claude.json
{
  "mcpServers": {
    "falsafa": {
      "type": "stdio",
      "command": "/path/to/bun",
      "args": ["run", "/path/to/falsafa/apps/mcp/src/index.ts"]
    }
  }
}
```

```toml
# ~/.codex/config.toml
[mcp_servers.falsafa]
command = "/path/to/bun"
args = ["run", "/path/to/falsafa/apps/mcp/src/index.ts"]
```

The agent inherits these — same install path the README documents for
end users. The agent sees `mcp__falsafa__list_works`,
`mcp__falsafa__search_corpus`, etc. in its native tool list and calls
them directly. No CLI wrapper, no special transport.

### 4. The result on disk

The agent writes `<run-dir>/<q-id>.json` containing:

```json
{
  "answer": "...the agent's prose answer...",
  "tool_calls": [
    {"name": "search_corpus", "args": {"query": "..."}, "result_summary": "..."},
    {"name": "read_chapter", "args": {...}, "result_summary": "..."}
  ],
  "citations": [
    {"work_slug": "...", "chapter_number": 3, "paragraph_id": "p-..."}
  ]
}
```

That's the entire artifact. No other state. The Eval Explorer at
`/eval` reads exactly these files (bundled into a single static
`eval.json`).

## Anti-cheat — the complete forbidden list

Both prompt builders include this block. Since 2026-04-28 the list
covers every file in the repo that could leak ground truth:

- Anything under `eval/` at the repo root — especially
  `eval/questions-revised-1000.json`, `eval/questions-draft-1000.json`,
  `eval/calibration-scores-blind.json`, `eval/calibration-report.md`
- `apps/mcp/eval/cases.json` (the smaller 44-case suite)
- Anything under `apps/mcp/eval/results/`
- Anything under `apps/mcp/eval/runs/` (peer agents' results,
  sample manifests, judge verdicts)
- Anything under `docs/eval-reports/`
- The repo source code or git history (in case any of the above leaks
  via comments)

The agent is also instructed not to answer from prior literary
knowledge — if it "recognises" a quote from training data, it must
still find it via the MCP. This is honesty-based; a model that has
trained on Ghalib's complete works could in principle answer without
the MCP. The eval still measures tool-use because:

1. The agent's `tool_calls` field is a verbatim trace; an empty trace
   on a citation question is itself a finding.
2. Hallucinated citations (paragraph_ids that don't resolve, quotes
   that aren't verbatim) are caught by the Sonnet judge in scoring.

## Scoring

Two layers, both off-line, both reading only the per-question JSON
files on disk.

### Mechanical (deterministic)

`apps/mcp/eval/runs/<run>/_score-mechanical.json` is produced by a
small bun script. For each question:

- `expected_works_overlap` = |expected_works ∩ cited_work_slugs| / |expected_works|
- Pass = overlap ≥ 0.5, OR (zero expected_works AND non-empty answer
  AND ≥1 citation)
- Per-category aggregate

Mechanical scoring under-counts correctness on roughly 5–15% of cases
(an answer is substantively right but cites a different valid work).
The judge corrects for this.

### Sonnet judge

`apps/mcp/eval/judge-1000.ts` dispatches one Sonnet sub-agent per
result with a judge prompt that includes:

- The original question
- The agent's answer + tool trace + citations
- The ground-truth `expected_works` and `rationale`

The judge has the Falsafa MCP attached too, and IS instructed to call
`mcp__falsafa__get_passage` to verify each cited paragraph_id resolves
and contains the quoted text. The verdict is JSON: `{factual_correct,
citation_backed, hallucinated, naturalness_1to5, reasoning}`.

The judge is itself blind to peer judgments and runs in a fresh
session per question. No leakage between judges.

## Reproducing a single question

```bash
# 1. Install the MCP for your client of choice (per README).
# 2. Generate a blind prompt for any question:
bun -e '
import { readFileSync, writeFileSync } from "fs";
import { buildSubagentPrompt } from "./apps/mcp/eval/run-subagent-evals.ts";
const pool = JSON.parse(readFileSync("eval/questions-revised-1000.json", "utf8"));
const q = pool.find(x => x.id === "q-0001");
const prompt = buildSubagentPrompt(
  { id: q.id, category: q.category, prompt: q.prompt,
    expected_tool_calls: [], expected_answer_contains: [], expects_citation: true },
  "my-rerun/agent"
);
writeFileSync("/tmp/q-0001.txt", prompt);
'
# 3. Open Claude Desktop / Cursor / Claude Code with the Falsafa MCP attached.
#    Paste the contents of /tmp/q-0001.txt.
# 4. The agent will return a JSON answer + tool trace + citations.
# 5. Compare its citations to the question's expected_works (mechanical
#    score) and/or run the Sonnet judge separately against its answer.
```

The result will not be byte-identical run-to-run — LLM stochasticity
is real — but the protocol guarantees:

- The agent saw exactly the question prompt + tool spec + anti-cheat
- The agent had no access to ground truth
- The result on disk is the entire artifact
- Same code path real users follow

## Invalidated runs

Runs from before 2026-04-28 used a `buildSubagentPrompt` whose
anti-cheat block listed `apps/mcp/eval/cases.json` and result/judge
directories but omitted `eval/questions-revised-1000.json`. Theoretical
gap — a sub-agent could in principle have read the question pool to
find ground truth. We have no evidence any did, but for paper rigor
those runs are **discarded**:

- `apps/mcp/eval/runs/1k-pilot-sonnet-native/`
- `apps/mcp/eval/runs/1k-stratified-50-sonnet/`
- `apps/mcp/eval/runs/1k-wave3-sonnet/`

A README in `apps/mcp/eval/runs/_INVALIDATED-pre-anti-cheat-patch/`
documents the chain. Files preserved for audit; not used in any
published headline number.

Future runs use the patched prompt builder. The single
patched-prompt rerun of q-0001
(`apps/mcp/eval/runs/1k-rerun-q0001-patched/`) is the proof point that
the new chain works end-to-end.
